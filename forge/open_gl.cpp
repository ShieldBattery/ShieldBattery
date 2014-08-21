#include "forge/open_gl.h"

#include <gl/glew.h>
#include <gl/wglew.h>
#include <gl/gl.h>
#include <map>
#include <memory>
#include <vector>
#include <string>

#include "forge/indirect_draw.h"
#include "forge/forge.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;
using std::map;
using std::pair;
using std::string;
using std::unique_ptr;
using std::vector;

unique_ptr<OpenGl> OpenGl::Create(HWND window, uint32 ddraw_width, uint32 ddraw_height,
    const map<string, pair<string, string>>& shaders) {
  unique_ptr<OpenGl> open_gl(new OpenGl(window, ddraw_width, ddraw_height, shaders));

  if (open_gl->has_error()) {
    Logger::Log(LogLevel::Error, "IndirectDraw failed to initialize OpenGL");
    // TODO(tec27): display this error message to the user (and exit?) instead of just logging it
    Logger::Log(LogLevel::Error, open_gl->error().c_str());
    open_gl.release();
  } else {
    Logger::Log(LogLevel::Verbose, "IndirectDraw initialized OpenGL successfully");
  }

  return open_gl;
}

GlContext::GlContext(const WinHdc& dc) 
  : context_(wglCreateContext(dc.get())) {
  if (context_ == NULL) {
    return;
  }
  wglMakeCurrent(dc.get(), context_);
}

GlContext::~GlContext() {
  if (!has_error()) {
    wglMakeCurrent(NULL, NULL);
    wglDeleteContext(context_);
  }
}

GlShader::GlShader(GLenum type, const std::string& src) 
  : id_(glCreateShader(type)) {
  GLint length = src.length();
  const GLchar* src_cstr = src.c_str();
  glShaderSource(id_, 1, reinterpret_cast<const GLchar**>(&src_cstr), &length);
  glCompileShader(id_);

  GLint shader_ok;
  glGetShaderiv(id_, GL_COMPILE_STATUS, &shader_ok);
  if (!shader_ok) {
    Logger::Log(LogLevel::Error, "OpenGl: compiling shader failed");
    GLint log_length;
    glGetShaderiv(id_, GL_INFO_LOG_LENGTH, &log_length);

    vector<char> log_str(log_length);
    glGetShaderInfoLog(id_, log_length, NULL, log_str.data());
    Logger::Log(LogLevel::Error, log_str.data());
    glDeleteShader(id_);
    id_ = 0;
  }
}

GlShader::~GlShader() {
  if (!has_error()) {
    glDeleteShader(id_);
  }
}

GlVertexShader::GlVertexShader(const std::string& src)
  : GlShader(GL_VERTEX_SHADER, src) {
}

GlVertexShader::~GlVertexShader() {
}

GlFragmentShader::GlFragmentShader(const std::string& src)
  : GlShader(GL_FRAGMENT_SHADER, src) {
}

GlFragmentShader::~GlFragmentShader() {
}

GlShaderProgram::GlShaderProgram(const std::string& vertex_src, const std::string& fragment_src)
  : id_(0),
    vertex_(vertex_src),
    fragment_(fragment_src) {
  if (vertex_.has_error() || fragment_.has_error()) {
    return;
  }

  id_ = glCreateProgram();
  glAttachShader(id_, vertex_.get());
  glAttachShader(id_, fragment_.get());
  glLinkProgram(id_);

  GLint program_ok;
  glGetProgramiv(id_, GL_LINK_STATUS, &program_ok);
  if (!program_ok) {
    Logger::Log(LogLevel::Error, "OpenGl: linking program failed");
    GLint log_length;
    glGetProgramiv(id_, GL_INFO_LOG_LENGTH, &log_length);
    
    vector<char> log_str(log_length);
    glGetProgramInfoLog(id_, log_length, NULL, log_str.data());
    Logger::Log(LogLevel::Error, log_str.data());
    glDeleteProgram(id_);
    id_ = 0;
  }
}

GlShaderProgram::~GlShaderProgram() {
  if (!has_error()) {
    glDeleteProgram(id_);
  }
}

// Constructing this *can* fail and leave a partially uninitialized object. The assumption is that
// this constructor will only ever be called by the factory method, and the factory method will take
// care of deleting any errored objects instead of returning them higher up, so no methods outside
// of the constructor will need to check for such a state.
OpenGl::OpenGl(HWND window, uint32 ddraw_width, uint32 ddraw_height,
    const map<string, pair<string, string>>& shaders)
  : error_(),
    window_(window),
    dc_(window),
    client_rect_(),
    gl_context_(),
    screen_shader_(),
    fbo_shader_(),
    shader_resources_(),
    min_millis_per_frame_(16),
    ddraw_width_(ddraw_width),
    ddraw_height_(ddraw_height),
    aspect_ratio_width_(0),
    aspect_ratio_height_(0),
    texture_internal_format_(GL_R8),
    texture_format_(GL_RED),
    screen_texture_(0),
    framebuffer_(0),
    framebuffer_texture_(0),
    vertex_buffer_(),
    element_buffer_(),
    fbo_vertex_buffer_(),
    fbo_element_buffer_(),
    rendered_texture_id_(0),
    settings_(GetSettings()),
    counter_frequency_(),
    last_frame_time_() {
  Logger::Log(LogLevel::Verbose, "IndirectDraw initializing OpenGL");
  GetClientRect(window, &client_rect_);

  PIXELFORMATDESCRIPTOR pixel_format = PIXELFORMATDESCRIPTOR();
  pixel_format.nSize = sizeof(pixel_format);
  pixel_format.nVersion = 1;
  pixel_format.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
  pixel_format.iPixelType = PFD_TYPE_RGBA;
  pixel_format.cColorBits = 24;
  pixel_format.cDepthBits = 16;
  int format = ChoosePixelFormat(dc_.get(), &pixel_format);
  SetPixelFormat(dc_.get(), format, &pixel_format);

  gl_context_.reset(new GlContext(dc_));
  if (gl_context_->has_error()) {
    error_ = "Could not initialize OpenGL context";
    return;
  }

  GLenum err = glewInit();
  if (err != GLEW_OK)  {
    Logger::Logf(LogLevel::Error, "GLEW error: %s", glewGetErrorString(err));
    error_ = "Could not initialize GLEW";
    return;
  }
  if (!GLEW_VERSION_3_1) {
    Logger::Log(LogLevel::Error, "OpenGL 3.1 not available");
    error_ = "This computer does not support OpenGL 3.1. Please try a different renderer.";
    return;
  }

  if (!WGLEW_EXT_swap_control) {
    Logger::Log(LogLevel::Warning, "OpenGL does not support swap control, vsync may cause issues");
  } else {
    wglSwapIntervalEXT(0);  // disable vsync, which causes some pretty annoying issues in BW
  }

  // TODO(tec27): make a more generic shader manager instead of finding these keys by literal
  // TODO(tec27): shader asserts should be proper error handling
  if (shaders.count("main") != 0) {
    const pair<string, string> shader_pair = shaders.at("main");
    screen_shader_.reset(new GlShaderProgram(shader_pair.first, shader_pair.second));
  }
  if (shaders.count("fbo") != 0) {
    const pair<string, string> shader_pair = shaders.at("fbo");
    fbo_shader_.reset(new GlShaderProgram(shader_pair.first, shader_pair.second));
  }

  if (screen_shader_->has_error() || fbo_shader_->has_error()) {
    error_ = "Could not build shaders";
    return;
  }

  shader_resources_.uniforms.bw_screen = screen_shader_->GetUniformLocation("bw_screen");
  shader_resources_.uniforms.palette = screen_shader_->GetUniformLocation("palette");
  shader_resources_.attributes.position = screen_shader_->GetAttribLocation("position");
  shader_resources_.attributes.texpos = screen_shader_->GetAttribLocation("texpos");
  shader_resources_.uniforms.rendered_texture = fbo_shader_->GetUniformLocation("renderedTexture");

  DEVMODE devmode;
  EnumDisplaySettings(NULL, ENUM_CURRENT_SETTINGS, &devmode);
  if (devmode.dmDisplayFrequency <= 1) {
    // "Default" setting for the device. I don't know what that means, but the docs say this can
    // happen, so we'll assume 60hz since that's fairly common and non-problematic
    min_millis_per_frame_ = 16;
  } else {
    min_millis_per_frame_ = 1000 / devmode.dmDisplayFrequency;
  }
  Logger::Logf(LogLevel::Verbose, "OpenGl selected min delay per frame: %dms",
      min_millis_per_frame_);

  // TODO(tec27): handle MakeResources failures instead of doing asserts on things that are valid
  // code paths (but errors)
  MakeResources();
}

OpenGl::~OpenGl() {
}

void OpenGl::SwapBuffers() {
  ::SwapBuffers(dc_.get());
}

void OpenGl::MakeResources() {
  // X, Y, U, V -- this flips the texture vertically so it matches the orientation of DDraw surfaces
  const array<GLfloat, 16> vertex_data =
      { -1.0f, -1.0f, 0.0f, 1.0f,
        1.0f, -1.0f, 1.0f, 1.0f,
        -1.0f, 1.0f, 0.0f, 0.0f,
        1.0f, 1.0f, 1.0f, 0.0f };
  vertex_buffer_.reset(new GlStaticBuffer<GLfloat, 16>(GL_ARRAY_BUFFER, vertex_data));
  const array<GLushort, 4> element_data = { 0, 1, 2, 3 };
  element_buffer_.reset(new GlStaticBuffer<GLushort, 4>(GL_ELEMENT_ARRAY_BUFFER, element_data));

  // Texture that BW's rendered data will be placed in
  glGenTextures(1, &screen_texture_);
  // Framebuffer that gets rendered to in order to convert from palletized -> RGB
  glGenFramebuffers(1, &framebuffer_);
  glGenTextures(1, &framebuffer_texture_);
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, screen_texture_);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, texture_internal_format_, ddraw_width_, ddraw_height_, 0,
      texture_format_, GL_UNSIGNED_BYTE, NULL);

  glBindFramebuffer(GL_FRAMEBUFFER, framebuffer_);
  glBindTexture(GL_TEXTURE_2D, framebuffer_texture_);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGB, ddraw_width_, ddraw_height_, 0, GL_RGB, GL_UNSIGNED_BYTE,
      NULL);

  GLenum draw_buffers[1] = { GL_COLOR_ATTACHMENT0 };
  glFramebufferTexture2D(
      GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, framebuffer_texture_, 0);
  glDrawBuffers(1, draw_buffers);
  assert(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE);

  const array<GLfloat, 16> fbo_vertex_data =
      { -1.0f, -1.0f, 0.0f, 0.0f,
        1.0f, -1.0f, 1.0f, 0.0f,
        -1.0f, 1.0f, 0.0f, 1.0f,
        1.0f, 1.0f, 1.0f, 1.0f };
  fbo_vertex_buffer_.reset(new GlStaticBuffer<GLfloat, 16>(GL_ARRAY_BUFFER, fbo_vertex_data));
  const array<GLushort, 4> fbo_element_data = { 0, 1, 2, 3 };
  fbo_element_buffer_.reset(new GlStaticBuffer<GLushort, 4>(GL_ELEMENT_ARRAY_BUFFER,
      fbo_element_data));

  if (settings_.display_mode == DisplayMode::FullScreen && settings_.maintain_aspect_ratio) {
    aspect_ratio_width_ = client_rect_.right;
    aspect_ratio_height_ = client_rect_.bottom;

    if (aspect_ratio_width_ > aspect_ratio_height_) {
      aspect_ratio_width_ = static_cast<int>((aspect_ratio_height_ * 1.333) + 0.5);
    } else {
      aspect_ratio_height_ = static_cast<int>((aspect_ratio_width_ * 0.75) + 0.5);
    }
  }

  QueryPerformanceFrequency(&counter_frequency_);
  counter_frequency_.QuadPart /= 1000LL;  // convert to ticks per millisecond
}

void OpenGl::Render(const IndirectDrawPalette &indirect_draw_palette,
    const std::vector<byte> &surface_data) {
  // BW has a nasty habit of trying to render ridiculously fast (like in the middle of a tight 7k
  // iteration loop during data intialization when there's nothing to actually render) and this
  // causes issues when the graphics card decides it doesn't want to queue commands any more. To
  // avoid these issues, we attempt to kill vsync, but also try to help BW out by not actually
  // making rendering calls this fast. We try to pick a value that matches the monitor's refresh
  // rate, falling back to 60hz if we don't know what that is.
  LARGE_INTEGER frame_time;
  QueryPerformanceCounter(&frame_time);
  if ((frame_time.QuadPart - last_frame_time_.QuadPart) / counter_frequency_.QuadPart < 
      min_millis_per_frame_) {
    return;
  }
  // Don't render while minimized (we tell BW its never minimized, so even though it has a check for
  // this, it will be rendering anyway)
  if (IsIconic(window_)) {
    return;
  }

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "OpenGl rendering");
  }

  glBindTexture(GL_TEXTURE_2D, screen_texture_);
  glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, ddraw_width_, ddraw_height_, texture_format_,
      GL_UNSIGNED_BYTE, &surface_data[0]);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "OpenGl rendering - after screen texture copied");
  }

  // Bind the framebuffer for drawing to
  glBindFramebuffer(GL_FRAMEBUFFER, framebuffer_);
  glViewport(0, 0, ddraw_width_, ddraw_height_);

  const ShaderResources* resources = &shader_resources_;
  screen_shader_->Use();

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "OpenGl rendering - after use program");
  }

  // Draw from the screen texture to the FBO texture (de-palettize)
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, screen_texture_);
  glUniform1i(resources->uniforms.bw_screen, screen_texture_);
  indirect_draw_palette.BindTexture(resources->uniforms.palette, GL_TEXTURE10, 10);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "OpenGl rendering - after textures bound");
  }

  glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer_->buffer());
  glEnableVertexAttribArray(resources->attributes.position);
  glVertexAttribPointer(resources->attributes.position, 2, GL_FLOAT, GL_FALSE, sizeof(GLfloat) * 4,
      reinterpret_cast<void*>(0));
  glEnableVertexAttribArray(resources->attributes.texpos);
  glVertexAttribPointer(resources->attributes.texpos, 2, GL_FLOAT, GL_TRUE, sizeof(GLfloat) * 4,
      reinterpret_cast<void*>(sizeof(GLfloat) * 2));
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, element_buffer_->buffer());
  glDrawElements(GL_TRIANGLE_STRIP, 4, GL_UNSIGNED_SHORT, reinterpret_cast<void*>(0));

  glDisableVertexAttribArray(resources->attributes.texpos);
  glDisableVertexAttribArray(resources->attributes.position);

  // Unbind the framebuffer so we can render to the screen
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  if (settings_.display_mode != DisplayMode::FullScreen) {
    glViewport(0, 0, settings_.width, settings_.height);
  } else if (aspect_ratio_width_ > 0) {
    glViewport(static_cast<int>(((client_rect_.right - aspect_ratio_width_) / 2) + 0.5),
        static_cast<int>(((client_rect_.bottom - aspect_ratio_height_) / 2) + 0.5),
        aspect_ratio_width_, aspect_ratio_height_);
  } else {
    glViewport(0, 0, client_rect_.right, client_rect_.bottom);
  }

  fbo_shader_->Use();

  glActiveTexture(GL_TEXTURE1);
  glBindTexture(GL_TEXTURE_2D, framebuffer_texture_);
  glUniform1i(resources->uniforms.rendered_texture, 1);

  glBindBuffer(GL_ARRAY_BUFFER, fbo_vertex_buffer_->buffer());
  glEnableVertexAttribArray(0);
  glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, sizeof(GLfloat) * 4,
    reinterpret_cast<void*>(0));
  glEnableVertexAttribArray(1);
  glVertexAttribPointer(1, 2, GL_FLOAT, GL_FALSE, sizeof(GLfloat) * 4,
    reinterpret_cast<void*>(sizeof(GLfloat) * 2));
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, fbo_element_buffer_->buffer());
  glDrawElements(GL_TRIANGLE_STRIP, 4, GL_UNSIGNED_SHORT, reinterpret_cast<void*>(0));

  glDisableVertexAttribArray(0);

  SwapBuffers();

  QueryPerformanceCounter(&last_frame_time_);
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "OpenGl rendering completed [perf counter: %lld]",
        last_frame_time_.QuadPart / counter_frequency_.QuadPart);
  }
}

}  // namespace forge
}  // namespace sbat