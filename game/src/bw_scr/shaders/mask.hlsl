struct VS_OUTPUT
{
    float4 pos : SV_POSITION;
    float2 texCoord : TEXCOORD0;
};

SamplerState maskSampler : register(s0);
Texture2D <float4> mask: register(t0);

struct PS_OUTPUT
{
    float4 frag_color : SV_Target0;
};

cbuffer constants
{
    // if 0, uses the normal BW behaviour where unexplored areas are black (For UMS),
    // otherwise makes unexplored areas somewhat visible as well.
    float useNewMask;
    // if 1, the network is currently stalled and the game should be shaded accordingly
    float showNetworkStalled;
    // Mask value of never-explored terrain: 1.0 for players, 218/255 for observers and replays
    // (BW's fog curve caps their darkness lower).
    float unexploredMask;
    float _unused;
    // Map pixel at texCoord (0, 0), and how many map pixels the texture spans: the game screen
    // for the main view, the whole map for the minimap. Anchors the grain to the map and, through
    // its screen-space derivative, tells how large a map pixel is on screen.
    float2 mapOrigin;
    float2 mapSpan;
    // How never-explored terrain is drawn (`FogStyle` in fog_style.rs), with the values of
    // whichever view this draw is, the game view or the minimap.
    float unexploredAlpha;
    // 0 for no grain.
    float grainStrength;
    // Multiplier on grain size.
    float grainScale;
    float boundaryAlpha;
    // In screen pixels.
    float boundaryWidth;
    // 0 = black line, 1 = BOUNDARY_COLOR, brighter above.
    float boundaryBrightness;
    // Radius, in map pixels, of the extra smoothing the boundary line is traced on.
    float boundarySmoothing;
    // Map pixels between the boundary line and currently visible terrain at which the line starts
    // to show, and at which it shows fully. A line traced right along the edge of what units see
    // reads as clutter around them. Both 0 always show it.
    float boundaryClearanceStart;
    float boundaryClearanceFull;
    // The map's size in map pixels.
    float2 mapSize;
};

// Mask value BW gives explored terrain that isn't currently visible (visible terrain is 0).
#define EXPLORED_MASK (170.0 / 255.0)

#define BOUNDARY_COLOR float3(0.62, 0.68, 0.80)
// Grain: two octaves of value noise, a coarse "cluster" one and a fine "dye cloud" one, cell sizes
// in map pixels before grainScale.
#define GRAIN_CLUSTER_CELL 3.0
#define GRAIN_FINE_CELL 1.2
// Standard deviation of valueNoise (measured), to normalize each octave to unit variance.
#define VALUE_NOISE_STD 0.2147
// Standard deviation of the fog's density per unit of grainStrength.
#define GRAIN_DENSITY_PER_STRENGTH 0.06
// Rings, and directions per ring, sampled to find how far currently visible terrain is.
#define VISION_RINGS 6
#define VISION_DIRECTIONS 12

// 1 inside a line of `width` screen pixels, given the distance from its center, with an
// antialiased edge `feather` pixels wide.
float lineCoverage(float distPx, float width, float feather)
{
    return 1.0 - smoothstep(width * 0.5 - feather * 0.5, width * 0.5 + feather * 0.5, distPx);
}

// The mask at `uv`, read as if the map's edge tiles carried on past it. Observers can scroll the
// view past the bottom of the map, where BW's mask is unexplored, and the boundary line would
// otherwise trace the map's edge there. The line is cut off at the edge where it is drawn.
float sampleMask(float2 uv)
{
    float2 texSize;
    mask.GetDimensions(texSize.x, texSize.y);
    // Held half a texel inside, so filtering doesn't blend in what lies past the edge.
    float2 halfTexel = 0.5 * mapSpan / texSize;
    float2 mapPos = mapOrigin + uv * mapSpan;
    if (all(mapSize > 0.0))
    {
        mapPos = clamp(mapPos, halfTexel, mapSize - halfTexel);
    }
    return mask.SampleLevel(maskSampler, (mapPos - mapOrigin) / max(mapSpan, 1.0), 0.0).x;
}

// Pseudo-random 0..1 per integer cell.
float cellRandom(float2 cell)
{
    uint2 p = asuint(int2(cell));
    uint h = p.x * 374761393u + p.y * 668265263u;
    h = (h ^ (h >> 13)) * 1274126177u;
    h = h ^ (h >> 16);
    return (h & 0xffff) / 65535.0;
}

// Smoothly interpolated value noise, one random value per cell corner.
float valueNoise(float2 pos)
{
    float2 cell = floor(pos);
    float2 f = pos - cell;
    f = f * f * (3.0 - 2.0 * f);
    float top = lerp(cellRandom(cell), cellRandom(cell + float2(1.0, 0.0)), f.x);
    float bottom = lerp(cellRandom(cell + float2(0.0, 1.0)), cellRandom(cell + float2(1.0, 1.0)), f.x);
    return lerp(top, bottom, f.y);
}

// One octave of grain: zero-mean, unit-variance value noise, on a grid rotated by `angle` so the
// octaves don't share axis-aligned seams. Fades to 0 once its cells are smaller than a couple of
// screen pixels, the way minified film grain averages out, rather than shimmering.
float grainOctave(float2 mapPos, float cell, float angle, float2 offset, float screenPxPerMapPx)
{
    float s = sin(angle);
    float c = cos(angle);
    float2 pos = mul(float2x2(c, -s, s, c), mapPos / cell) + offset;
    float g = (valueNoise(pos) - 0.5) / VALUE_NOISE_STD;
    return g * smoothstep(1.0, 2.0, cell * screenPxPerMapPx);
}

// Film-style grain: a zero-mean, unit-variance fluctuation, cluster and dye cloud octaves mixed
// in power ((a + b) / sqrt(2)) so the mix keeps unit variance.
float grain(float2 mapPos, float screenPxPerMapPx)
{
    float cluster = grainOctave(
        mapPos, GRAIN_CLUSTER_CELL * grainScale, 0.6, float2(0.0, 0.0), screenPxPerMapPx);
    float fine = grainOctave(
        mapPos, GRAIN_FINE_CELL * grainScale, 1.7, float2(17.3, 29.4), screenPxPerMapPx);
    return (cluster + fine) * 0.70710678;
}

// Straight-alpha `top` composited over straight-alpha `bottom`.
float4 over(float4 top, float4 bottom)
{
    float a = top.a + bottom.a * (1.0 - top.a);
    float3 premul = top.rgb * top.a + bottom.rgb * bottom.a * (1.0 - top.a);
    return float4(premul / max(a, 1e-5), a);
}

// Screen pixels from `uv` to where the mask crosses `level`, traced on a smoothed copy of the
// mask. BW builds the mask from one 8-bit value per tile, so its own contours wobble with the
// tile staircase and the quantization steps; averaging two rings of samples rounds those off,
// and the same samples give a least-squares slope that is continuous from pixel to pixel (fwidth
// steps per 2x2 pixel quad, which makes a line traced with it jagged).
float distanceToLevel(float2 uv, float2 uvPerPx, float maskValue, float level)
{
    float2 texSize;
    mask.GetDimensions(texSize.x, texSize.y);
    // Never under a texel, so the slope estimate always spans real texture differences.
    float2 radius = max(boundarySmoothing / max(mapSpan, 1.0), 1.0 / texSize);

    float sum = maskValue;
    float2 slopeSum = 0.0;
    float2 offsetSqSum = 0.0;
    [unroll]
    for (int i = 0; i < 8; i++)
    {
        float angle = i * 0.78539816;
        float2 dir = float2(cos(angle), sin(angle));
        [unroll]
        for (int ring = 1; ring <= 2; ring++)
        {
            float2 offset = dir * radius * (ring * 0.5);
            float value = sampleMask(uv + offset);
            sum += value;
            slopeSum += value * offset;
            offsetSqSum += offset * offset;
        }
    }
    float smoothed = sum / 17.0;
    // Slope per uv unit; the rings are symmetric, so each axis solves independently.
    float2 slopePerUv = slopeSum / offsetSqSum;
    float slopePerPx = length(slopePerUv * uvPerPx);
    return abs(smoothed - level) / max(slopePerPx, 1e-5);
}

// Map pixels from `uv` to the nearest currently visible terrain, out to `reach` (which it returns
// when nothing that near is visible). Sampled on rings, each turned half a direction from the last
// so their gaps don't line up. A sample counts as far as its visibility, read from where its
// filtered mask value falls between visible (0) and explored: a fully visible one puts vision
// within its ring's inner edge, a partly visible one part of the way out to `reach`, which keeps
// the distance continuous as vision moves.
float distanceToVision(float2 uv, float reach)
{
    float ringStep = reach / VISION_RINGS;
    float2 uvPerMapPx = 1.0 / max(mapSpan, 1.0);
    float nearest = reach;
    [unroll]
    for (int ring = 1; ring <= VISION_RINGS; ring++)
    {
        float radius = ring * ringStep;
        [unroll]
        for (int i = 0; i < VISION_DIRECTIONS; i++)
        {
            float angle = (i + (ring & 1) * 0.5) * (6.2831853 / VISION_DIRECTIONS);
            float2 offset = float2(cos(angle), sin(angle)) * radius * uvPerMapPx;
            float value = sampleMask(uv + offset);
            float visible = 1.0 - saturate(value / EXPLORED_MASK);
            nearest = min(nearest, lerp(reach, radius - ringStep, visible));
        }
    }
    return max(nearest, 0.0);
}

PS_OUTPUT main(VS_OUTPUT v)
{
    PS_OUTPUT o;
    float2 mapPos = mapOrigin + v.texCoord * mapSpan;
    float screenPxPerMapPx = 1.0 / max(fwidth(mapPos.x), 1e-4);
    // Observers can scroll the view past the bottom of the map, where there is no terrain, only
    // the tileset's background (Space Platform's stars). It is covered in black, with the edge
    // antialiased over a screen pixel.
    float2 insideMapPx = min(mapPos, mapSize - mapPos) * screenPxPerMapPx;
    // A map size of 0 (never written) covers nothing.
    float onMap = all(mapSize > 0.0) ? saturate(min(insideMapPx.x, insideMapPx.y) + 0.5) : 1.0;
    float4 offMapCover = float4(0.0, 0.0, 0.0, 1.0 - onMap);

    float3 stallColor = showNetworkStalled * float3(0.16, 0.08, 0.16);
    if (useNewMask == 0.0)
    {
        float4 nativeColor = float4(stallColor, mask.Sample(maskSampler, v.texCoord).x);
        o.frag_color = over(offMapCover, nativeColor);
        return o;
    }
    float maskValue = sampleMask(v.texCoord);

    // How unexplored this pixel is, 0 on explored terrain to 1 on never-explored terrain. The
    // mask is blurred, so this ramps smoothly across the boundary.
    float unexplored = smoothstep(EXPLORED_MASK + 0.02, unexploredMask - 0.02, maskValue);

    // Grain is a fluctuation in the fog's density, darker and lighter around its base. It only
    // runs on unexplored terrain, which keeps the visible and explored parts of the screen about
    // as cheap as BW's own one-sample mask.
    float unexploredDensity = unexploredAlpha;
    if (unexplored > 0.0 && grainStrength > 0.0)
    {
        float sigma = grainStrength * GRAIN_DENSITY_PER_STRENGTH;
        unexploredDensity = saturate(unexploredAlpha + grain(mapPos, screenPxPerMapPx) * sigma);
    }

    // Visible and explored terrain keep BW's own mask values.
    float4 color = float4(stallColor, lerp(min(maskValue, EXPLORED_MASK), unexploredDensity, unexplored));

    float boundaryLevel = (EXPLORED_MASK + unexploredMask) * 0.5;
    // The mask quads are axis-aligned, so each axis' uv per screen pixel is independent.
    float2 uvPerPx = abs(float2(ddx(v.texCoord.x), ddy(v.texCoord.y)));
    // Cheap first guess at the distance to the line (from fwidth, so coarse); the smoothed trace's
    // 16 extra samples only run where the line could be. Flat mask (fwidth 0) is never near it.
    float roughDistPx = abs(maskValue - boundaryLevel) / max(fwidth(maskValue), 1e-5);
    float smoothingPx = boundarySmoothing * screenPxPerMapPx;
    float reachPx = 2.0 * (boundaryWidth + smoothingPx) + 8.0;
    if (boundaryAlpha > 0.0 && roughDistPx < reachPx)
    {
        float distPx = distanceToLevel(v.texCoord, uvPerPx, maskValue, boundaryLevel);
        // Past the map's edge the mask carries the edge tiles on, which would carry the line on
        // with them, so it stops at the edge.
        float boundary = lineCoverage(distPx, boundaryWidth, 1.5) * boundaryAlpha * onMap;
        if (boundary > 0.0 && boundaryClearanceFull > 0.0)
        {
            float vision = distanceToVision(v.texCoord, boundaryClearanceFull);
            boundary *= smoothstep(boundaryClearanceStart, boundaryClearanceFull, vision);
        }
        color = over(float4(saturate(BOUNDARY_COLOR * boundaryBrightness), boundary), color);
    }

    o.frag_color = over(offMapCover, color);
    return o;
}
