#version 330

attribute vec2 position;
attribute vec2 texpos;

varying vec2 texcoord;

void main() {
  gl_Position = vec4(position, 0.0, 1.0);
  texcoord = texpos;
}
