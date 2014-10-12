Texture2D<uint> bw_screen : register(t0);
Texture2D<float4> palette : register(t1);
SamplerState ss : register(s0);

struct PS_Input
{
  float4 pos : SV_POSITION;
  float2 texcoord : TEXCOORD0;
};

float4 PS_Main(PS_Input frag) : SV_TARGET
{
  uint color_index = bw_screen.Load(int3(frag.texcoord.x * 640, frag.texcoord.y * 480, 0));
  float4 texel = palette.Load(int3(color_index, 0, 0));
  return texel;
}
