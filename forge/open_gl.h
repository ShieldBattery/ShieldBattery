#ifndef FORGE_OPEN_GL_H_
#define FORGE_OPEN_GL_H_

#include <node.h>
#include <Windows.h>
#include <gl/glew.h>
#include <gl/gl.h>
#include <array>
#include <memory>
#include <vector>

#include "common/types.h"
#include "shieldbattery/settings.h"

namespace sbat {
namespace forge {

struct ShaderResources {
  struct {
    GLint bw_screen;
    GLint palette;
  } uniforms;

  struct {
    GLint position;
    GLint texpos;
  } attributes;
};

class DirectGlaw;
class DirectGlawPalette;

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

class OpenGl {
public:
  OpenGl(HWND window, DWORD display_width, DWORD display_height);
  virtual ~OpenGl();

  void InitializeOpenGl(DirectGlaw* direct_glaw);
  void SwapBuffers();
  void SetShaders(std::string* vert_shader_src, std::string* frag_shader_src, const char* type);
  void MakeResources();
  void Render(const DirectGlawPalette &direct_glaw_palette, const std::vector<byte> &surface_data);

private:
  GLuint BuildShader(GLenum type, std::string* src);
  void BuildProgram(const char* type);

  HDC dc_;
  HWND window_;
  HGLRC gl_context_;
  bool initialized_;
  GLuint vertex_shader_;
  GLuint fragment_shader_;
  GLuint shader_program_;
  ShaderResources shader_resources_;
  GLuint fbo_vertex_shader_;
  GLuint fbo_fragment_shader_;
  GLuint fbo_shader_program_;

  DWORD width_;
  DWORD height_;
  DWORD aspect_ratio_width_;
  DWORD aspect_ratio_height_;
  uint32 texture_internal_format_;
  uint32 texture_format_;
  std::array<GLuint, 2> textures_;
  uint32 texture_in_use_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> element_buffer_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> fbo_vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> fbo_element_buffer_;
  GLuint frame_buffer_name_;
  GLuint rendered_texture_;
  GLuint texID_;
  const Settings& settings_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_OPEN_GL_H_