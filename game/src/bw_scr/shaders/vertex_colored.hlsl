// SC:R's `VertexColored` pixel shader (textured, tinted by a per-vertex color), with the brightness
// curve.

#include "brightness.hlsli"

SamplerState textureSampler : register(s0);
Texture2D<float4> tex : register(t0);

struct VS_OUTPUT
{
    float4 pos : SV_Position;
    float2 texCoord : TEXCOORD0;
    float4 color : COLOR0;
};

float4 main(VS_OUTPUT v) : SV_Target0
{
    return withBrightness(tex.Sample(textureSampler, v.texCoord) * v.color * solidColor);
}
