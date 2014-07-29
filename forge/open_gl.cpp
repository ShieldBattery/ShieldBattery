#include "forge/open_gl.h"

#include <gl/glew.h>
#include <gl/wglew.h>
#include <gl/gl.h>
#include <vector>

#include "forge/direct_glaw.h"
#include "forge/forge.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;

OpenGl::OpenGl(HWND window, uint32 ddraw_width, uint32 ddraw_height)
  : dc_(NULL),
    window_(window),
    client_rect_(),
    gl_context_(NULL),
    initialized_(false),
    vertex_shader_(0),
    fragment_shader_(0),
    shader_program_(0), 
    shader_resources_(),
    fbo_vertex_shader_(0),
    fbo_fragment_shader_(0),
    fbo_shader_program_(0),
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
  GetClientRect(window, &client_rect_);
}

OpenGl::~OpenGl() {
  if (initialized_) {
    // TODO(tec27): wrap this in RAII classes instead
    wglMakeCurrent(NULL, NULL);
    wglDeleteContext(gl_context_);
    ReleaseDC(window_, dc_);
  }

  if (shader_program_) {
    glDeleteProgram(shader_program_);
    shader_program_ = 0;
  }
  if (vertex_shader_) {
    glDeleteShader(vertex_shader_);
    vertex_shader_ = 0;
  }
  if (fragment_shader_) {
    glDeleteShader(fragment_shader_);
    fragment_shader_ = 0;
  }
}

void OpenGl::InitializeOpenGl(DirectGlaw* direct_glaw) {
  if (initialized_) return;

  Logger::Log(LogLevel::Verbose, "DirectGlaw initializing OpenGL");

  assert(window_ != NULL);
  dc_ = GetDC(window_);

  PIXELFORMATDESCRIPTOR pixel_format = PIXELFORMATDESCRIPTOR();
  pixel_format.nSize = sizeof(pixel_format);
  pixel_format.nVersion = 1;
  pixel_format.dwFlags = PFD_DRAW_TO_WINDOW | PFD_SUPPORT_OPENGL | PFD_DOUBLEBUFFER;
  pixel_format.iPixelType = PFD_TYPE_RGBA;
  pixel_format.cColorBits = 24;
  pixel_format.cDepthBits = 16;
  int format = ChoosePixelFormat(dc_, &pixel_format);
  SetPixelFormat(dc_, format, &pixel_format);

  gl_context_ = wglCreateContext(dc_);
  assert(gl_context_ != NULL);
  wglMakeCurrent(dc_, gl_context_);

  GLenum err = glewInit();
  if (err != GLEW_OK)  {
    // TODO(tec27): kill process somehow
    Logger::Logf(LogLevel::Error, "GLEW error: %s", glewGetErrorString(err));
    return;
  }
  if (!GLEW_VERSION_3_1) {
    Logger::Log(LogLevel::Error, "OpenGL 3.1 not available");
    return;
  }

  if (!WGLEW_EXT_swap_control) {
    Logger::Log(LogLevel::Warning, "OpenGL does not support swap control, vsync may cause issues");
  } else {
    wglSwapIntervalEXT(0); // disable vsync, which causes some pretty annoying issues in BW
  }

  Forge::RegisterDirectGlaw(this, direct_glaw);
  MakeResources();

  initialized_ = true;
  Logger::Log(LogLevel::Verbose, "DirectGlaw initialized OpenGL successfully");
}

void OpenGl::SwapBuffers() {
  assert(initialized_);
  ::SwapBuffers(dc_);
}

void OpenGl::SetShaders(std::string* vert_shader_src, std::string* frag_shader_src, const char* type) {
  if (type == "main") {
    vertex_shader_ = BuildShader(GL_VERTEX_SHADER, vert_shader_src);
    fragment_shader_ = BuildShader(GL_FRAGMENT_SHADER, frag_shader_src);
    assert(vertex_shader_ != 0);
    assert(fragment_shader_ != 0);
    BuildProgram("main");
  } else if (type == "fbo") {
    fbo_vertex_shader_ = BuildShader(GL_VERTEX_SHADER, vert_shader_src);
    fbo_fragment_shader_ = BuildShader(GL_FRAGMENT_SHADER, frag_shader_src);
    assert(fbo_vertex_shader_ != 0);
    assert(fbo_fragment_shader_ != 0);
    BuildProgram("fbo");
  }
}

GLuint OpenGl::BuildShader(GLenum type, std::string* src) {
  GLuint shader = glCreateShader(type);
  GLint length = src->length();
  const GLchar* shader_temp = src->c_str();
  glShaderSource(shader, 1, reinterpret_cast<const GLchar**>(&shader_temp), &length);
  glCompileShader(shader);

  GLint shader_ok;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &shader_ok);
  if (!shader_ok) {
    Logger::Log(LogLevel::Error, "DirectGlaw: compiling shader failed");
    GLint log_length;
    char* log;
    glGetShaderiv(shader, GL_INFO_LOG_LENGTH, &log_length);
    log = new char[log_length];
    glGetShaderInfoLog(shader, log_length, NULL, log);
    Logger::Log(LogLevel::Error, log);
    delete[] log;
    glDeleteShader(shader);
    return 0;
  }

  return shader;
}

void OpenGl::BuildProgram(const char* type) {
  GLuint new_program = glCreateProgram();
  if (type == "main") {
    glAttachShader(new_program, vertex_shader_);
    glAttachShader(new_program, fragment_shader_);
  } else if (type == "fbo") {
    glAttachShader(new_program, fbo_vertex_shader_);
    glAttachShader(new_program, fbo_fragment_shader_);
  }
  glLinkProgram(new_program);

  GLint program_ok;
  glGetProgramiv(new_program, GL_LINK_STATUS, &program_ok);
  if (!program_ok) {
    Logger::Log(LogLevel::Error, "DirectGlaw: linking program failed");
    GLint log_length;
    char* log;
    glGetProgramiv(new_program, GL_INFO_LOG_LENGTH, &log_length);
    log = new char[log_length];
    glGetProgramInfoLog(new_program, log_length, NULL, log);
    Logger::Log(LogLevel::Error, log);
    delete[] log;
    glDeleteProgram(new_program);
    return;
  }

  if (type == "main") {
    if (shader_program_ != 0) {
      glDeleteProgram(shader_program_);
    }
    shader_program_ = new_program;
  } else if (type == "fbo") {
    if (fbo_shader_program_ != 0) {
      glDeleteProgram(fbo_shader_program_);
    }
    fbo_shader_program_ = new_program;
  }
}

void OpenGl::MakeResources() {
  assert(shader_program_ != NULL);
  assert(fbo_shader_program_ != NULL);

  // bw rendering program resources
  shader_resources_.uniforms.bw_screen = glGetUniformLocation(shader_program_, "bw_screen");
  shader_resources_.uniforms.palette = glGetUniformLocation(shader_program_, "palette");
  shader_resources_.attributes.position = glGetAttribLocation(shader_program_, "position");
  shader_resources_.attributes.texpos = glGetAttribLocation(shader_program_, "texpos");
  // fbo rendering resources
  shader_resources_.uniforms.rendered_texture =
    glGetUniformLocation(fbo_shader_program_, "renderedTexture");

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
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, framebuffer_texture_, 0);
  glDrawBuffers(1, draw_buffers);
  assert(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE);

  const array<GLfloat, 16> fbo_vertex_data =
      { -1.0f, -1.0f, 0.0f, 0.0f,
        1.0f, -1.0f, 1.0f, 0.0f,
        -1.0f, 1.0f, 0.0f, 1.0f,
        1.0f, 1.0f, 1.0f, 1.0f };
  fbo_vertex_buffer_.reset(new GlStaticBuffer<GLfloat, 16>(GL_ARRAY_BUFFER, fbo_vertex_data));
  const array<GLushort, 4> fbo_element_data = { 0, 1, 2, 3 };
  fbo_element_buffer_.reset(new GlStaticBuffer<GLushort, 4>(GL_ELEMENT_ARRAY_BUFFER, fbo_element_data));

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
  counter_frequency_.QuadPart /= 1000LL; // convert to ticks per millisecond
}

void OpenGl::Render(const DirectGlawPalette &direct_glaw_palette, const std::vector<byte> &surface_data) {
  // BW has a nasty habit of trying to render ridiculously fast (like in the middle of a tight 7k
  // iteration loop during data intialization when there's nothing to actually render) and this
  // causes issues when the graphics card decides it doesn't want to queue commands any more. To
  // avoid these issues, we attempt to kill vsync, but also try to help BW out by not actually
  // making rendering calls this fast. 120Hz seems like a "reasonable" limit to me (and by
  // reasonable, I mean unlikely to cause weird issues), even though BW will never actually update
  // any state that fast.
  LARGE_INTEGER frame_time;
  QueryPerformanceCounter(&frame_time);
  if ((frame_time.QuadPart - last_frame_time_.QuadPart) / counter_frequency_.QuadPart < 8) {
    return;
  }
  // Don't render while minimized (we tell BW its never minimized, so even though it has a check for
  // this, it will be rendering anyway)
  if (IsIconic(window_)) {
    return;
  }

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering");
  }
  
  glBindTexture(GL_TEXTURE_2D, screen_texture_);
  glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, ddraw_width_, ddraw_height_, texture_format_,
      GL_UNSIGNED_BYTE, &surface_data[0]);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after screen texture copied");
  }
  
  if (!shader_program_ || !fbo_shader_program_) {
    return;
  }

  // Bind the framebuffer for drawing to
  glBindFramebuffer(GL_FRAMEBUFFER, framebuffer_);
  glViewport(0, 0, ddraw_width_, ddraw_height_);
 
  const ShaderResources* resources = &shader_resources_;
  glUseProgram(shader_program_);

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after use program");
  }

  // Draw from the screen texture to the FBO texture (de-palettize)
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, screen_texture_);
  glUniform1i(resources->uniforms.bw_screen, screen_texture_);
  direct_glaw_palette.BindTexture(resources->uniforms.palette, GL_TEXTURE10, 10);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after textures bound");
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

  glUseProgram(fbo_shader_program_);

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
        "DirectGlawSurface rendering completed [perf counter: %lld]",
        last_frame_time_.QuadPart / counter_frequency_.QuadPart);
  }
}

}  // namespace forge
}  // namespace sbat