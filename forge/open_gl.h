#ifndef FORGE_OPEN_GL_H_
#define FORGE_OPEN_GL_H_

#include <node.h>
#include <Windows.h>
#include <gl/glew.h>
#include <gl/gl.h>
#include <array>
#include <map>
#include <memory>
#include <vector>
#include <string>
#include <utility>

#include "common/macros.h"
#include "common/types.h"
#include "common/win_helpers.h"
#include "shieldbattery/settings.h"
#include "forge/renderer.h"

namespace sbat {
namespace forge {

struct ShaderResources {
  struct {
    GLint bw_screen;
    GLint palette;
    GLint rendered_texture;
  } uniforms;

  struct {
    GLint position;
    GLint texpos;
  } attributes;
};

class IndirectDraw;
class IndirectDrawPalette;

template <typename T, int n>
class GlStaticBuffer {
public:
  GlStaticBuffer(GLenum buffer_target, const std::array<T, n>& data) : data_(data), buffer_(0) {
    glGenBuffers(1, &buffer_);
    glBindBuffer(buffer_target, buffer_);
    glBufferData(buffer_target, data_.size() * sizeof(T), &data_[0], GL_STATIC_DRAW);
  }

  ~GlStaticBuffer() {
    if (buffer_) {
      glDeleteBuffers(1, &buffer_);
    }
  }

  inline GLuint buffer() { return buffer_; }

private:
  std::array<T, n> data_;
  GLuint buffer_;

  DISALLOW_COPY_AND_ASSIGN(GlStaticBuffer);
};

class GlContext {
public:
  explicit GlContext(const WinHdc& dc);
  ~GlContext();

  bool has_error() const { return context_ == NULL; }
private:
  HGLRC context_;

  DISALLOW_COPY_AND_ASSIGN(GlContext);
};

class GlShader {
public:
  GlShader(GLenum type, const std::string& src);
  virtual ~GlShader();

  bool has_error() const { return id_ == 0; }
  GLuint get() const { return id_; }
private:
  GLuint id_;

  DISALLOW_COPY_AND_ASSIGN(GlShader);
};

class GlVertexShader : public GlShader {
public:
  explicit GlVertexShader(const std::string& src);
  virtual ~GlVertexShader();
};

class GlFragmentShader : public GlShader {
public:
  explicit GlFragmentShader(const std::string& src);
  virtual ~GlFragmentShader();
};

class GlShaderProgram {
public:
  GlShaderProgram(const std::string& vertex_src, const std::string& fragment_src);
  ~GlShaderProgram();

  bool has_error() const { return id_ == 0; }
  GLuint get() const { return id_; }

  void Use() const { glUseProgram(id_); }
  GLint GetUniformLocation(const std::string& name) const {
    return glGetUniformLocation(id_, name.c_str());
  }
  GLint GetAttribLocation(const std::string& name) const {
    return glGetAttribLocation(id_, name.c_str());
  }
private:
  GLuint id_;
  GlVertexShader vertex_;
  GlFragmentShader fragment_;

  DISALLOW_COPY_AND_ASSIGN(GlShaderProgram);
};

class GlTexture {
public:
  GlTexture();
  ~GlTexture();

  GLuint get() const { return id_; }
private:
  GLuint id_;

  DISALLOW_COPY_AND_ASSIGN(GlTexture);
};

// TODO(tec27): we could make this safer by allowing only one active instance per active_texture
// per bind_target type
class GlTextureBinder {
public:
  GlTextureBinder(const GlTexture& texture, uint32 active_texture, GLenum bind_target);
  ~GlTextureBinder();

  GlTextureBinder& TexParameteri(GLenum param_name, GLint param);
  GlTextureBinder& TexImage2d(GLint level, GLint internal_format, GLsizei width, GLsizei height,
      GLint border, GLenum format, GLenum type, const GLvoid* data);
  GlTextureBinder& TexSubImage2d(GLint level, GLint xoffset, GLint yoffset, GLsizei width,
      GLsizei height, GLenum format, GLenum type, const GLvoid* data);
  GlTextureBinder& Uniform1i(GLint location);
private:
  uint32 active_texture_;
  GLenum bind_target_;

  DISALLOW_COPY_AND_ASSIGN(GlTextureBinder);
};

class GlFramebuffer {
public:
  GlFramebuffer();
  ~GlFramebuffer();

  GLuint get() const { return id_; }
private:
  GLuint id_;

  DISALLOW_COPY_AND_ASSIGN(GlFramebuffer);
};

class GlFramebufferBinder {
public:
  GlFramebufferBinder(const GlFramebuffer& framebuffer, GLenum bind_target);
  ~GlFramebufferBinder();

  GlFramebufferBinder& Texture2d(GLenum attachment, GLenum textarget, GLuint texture, GLint level);
  GlFramebufferBinder& DrawBuffers(GLsizei n, const GLenum* bufs);

  GLenum CheckStatus() const { return glCheckFramebufferStatus(bind_target_); }
private:
  GLenum bind_target_;

  DISALLOW_COPY_AND_ASSIGN(GlFramebufferBinder);
};

class OpenGl : public Renderer {
public:
  virtual ~OpenGl();

  static std::unique_ptr<OpenGl> Create(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);

  virtual void Render(const std::vector<byte>& surface_data);
  virtual void UpdatePalette(const IndirectDrawPalette& palette);

  bool has_error() { return !error_.empty(); }
  std::string error() { return error_; }

private:
  #pragma pack(push, 1)
  struct PaletteTextureEntry {
    byte blue;
    byte green;
    byte red;
    byte alpha;
  };
  #pragma pack(pop)

  OpenGl(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitShaders(const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitTextures();
  bool InitVertices();

  void SwapBuffers();

  void CopyDdrawSurface(const std::vector<byte>& surface_data);
  void ConvertToFullColor();
  void RenderToScreen();

  static inline PaletteTextureEntry ConvertToPaletteTextureEntry(const PALETTEENTRY& entry) {
    const PaletteTextureEntry result = { entry.peBlue, entry.peGreen, entry.peRed, 255 };
    return result;
  }

  std::string error_;
  HWND window_;
  WinHdc dc_;
  RECT client_rect_;
  std::unique_ptr<GlContext> gl_context_;
  std::unique_ptr<GlShaderProgram> screen_shader_;
  std::unique_ptr<GlShaderProgram> fbo_shader_;
  ShaderResources shader_resources_;

  uint32 min_millis_per_frame_;
  uint32 ddraw_width_;
  uint32 ddraw_height_;
  uint32 aspect_ratio_width_;
  uint32 aspect_ratio_height_;
  uint32 texture_format_;
  std::unique_ptr<GlTexture> palette_texture_;
  std::array<PaletteTextureEntry, 256> palette_texture_data_;
  std::unique_ptr<GlTexture> ddraw_texture_;
  std::unique_ptr<GlFramebuffer> framebuffer_;
  std::unique_ptr<GlTexture> framebuffer_texture_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> element_buffer_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> fbo_vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> fbo_element_buffer_;
  // TODO(tec27): Don't reference settings at all in renderers
  const Settings& settings_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;

  DISALLOW_COPY_AND_ASSIGN(OpenGl);
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_OPEN_GL_H_