#version 330

layout(location = 0) in vec2 position;
layout(location = 1) in vec2 texpos;

out vec2 texcoord;

void main(){
  gl_Position = vec4(position, 0.0, 1.0);
  texcoord = texpos;
}
