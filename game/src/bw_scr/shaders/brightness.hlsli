// The constants of SC:R's plain textured shaders, and the brightness curve ShieldBattery adds to
// them. SC:R's own versions of these shaders read only `solidColor`; the rest of the buffer is
// laid out as SC:R uploads it (see docs/scr-prism-shaders.md) and unused by them.
cbuffer constants
{
    // Global RGBA multiply.
    float4 solidColor;
    float4 _unused1;
    float4 _unused2;
    float4 _unused3;
    // Exponent of the brightness curve applied to each RGB channel, 0 to leave the color as SC:R
    // computed it. Only draws to the backbuffer carry one, so the curve applies once to everything
    // shown, after it has been composited.
    float brightnessExponent;
};

// `color` with the brightness curve applied. Colors are straight (not premultiplied) alpha, as
// every one of SC:R's blend modes takes them, so the curve applies to the color as it is and
// leaves alpha alone.
float4 withBrightness(float4 color)
{
    float3 curved = pow(saturate(color.rgb), brightnessExponent);
    return brightnessExponent != 0.0 ? float4(curved, color.a) : color;
}
