struct VS_Input
{
  float2 pos : POSITION;
  float2 texcoord : TEXCOORD0;
};

struct VS_Output
{
  float4 pos : SV_POSITION;
  float2 texcoord : TEXCOORD0;
};

VS_Output VS_Main(VS_Input vertex)
{
  VS_Output vs_out = (VS_Output)0;
  vs_out.pos = float4(vertex.pos, 0.0f, 1.0f);
  vs_out.texcoord = vertex.texcoord;

  return vs_out;
}
