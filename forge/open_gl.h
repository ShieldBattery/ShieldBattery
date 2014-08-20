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

#include "common/types.h"
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
  // Disable copying
  GlStaticBuffer(const GlStaticBuffer&);
  GlStaticBuffer& operator=(const GlStaticBuffer&);

  std::array<T, n> data_;
  GLuint buffer_;
};

class OpenGl : public Renderer {
public:
  virtual ~OpenGl();

  static std::unique_ptr<OpenGl> Create(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  
  virtual void Render(const IndirectDrawPalette& indirect_draw_palette,
      const std::vector<byte>& surface_data);

private:
  OpenGl(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  GLuint BuildShader(GLenum type, const std::string& src);
  void BuildProgram(const char* type);
  void SwapBuffers();
  void MakeResources();

  HDC dc_;
  HWND window_;
  RECT client_rect_;
  HGLRC gl_context_;
  bool initialized_;
  GLuint vertex_shader_;
  GLuint fragment_shader_;
  GLuint shader_program_;
  ShaderResources shader_resources_;
  GLuint fbo_vertex_shader_;
  GLuint fbo_fragment_shader_;
  GLuint fbo_shader_program_;

  uint32 ddraw_width_;
  uint32 ddraw_height_;
  uint32 aspect_ratio_width_;
  uint32 aspect_ratio_height_;
  uint32 texture_internal_format_;
  uint32 texture_format_;
  GLuint screen_texture_;
  GLuint framebuffer_;
  GLuint framebuffer_texture_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> element_buffer_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> fbo_vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> fbo_element_buffer_;
  GLuint rendered_texture_id_;
  const Settings& settings_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_OPEN_GL_H_