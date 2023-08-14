
// Why
cursor_scale = client_height as f32 / 1920.0;

fn load_cursor_rgba() {
    // Transform frames into rgba buffers which are all same w/h
    if val.grp_bounds {
        // Use grp left/top * scale (4) for x/y bounds but get width/height
        // from ddsgrp frames.
        // So this copies all grp frames in full, leaving 0/0/0/0 rgba where
        // the frame doesn't extend.
    } else {
        // Remove ddsgrp borders where alpha == 0 for entire row/col
    }
    let scale_from_size = 64.0 / width.max(height) as f32;
    let scale = cursor_scale.min(scale_from_size);
    if scale < 1.0 {
        let scaled_w = (width as f32 * scale) as u32;
        let scaled_h = (height as f32 * scale) as u32;
        for frame in &mut frames {
            frame.data = scale(&frame.data, scaled_w, scaled_h);
        }
    }
    scale(rgba, count, w, h, 0xa, arg_scaled_w, arg_scaled_h)
}

fn x() {
    let bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: width,
            biHeight: height,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB,
            biSizeImage: width * height * 4,
            biXPelsPerMeter: 0,
            biYPelsPerMeter: 0,
            biClrUsed: 0,
            biClrImportant: 0,
        },
        bmiColors: [RGBQUAD { rgbBlue: 0, rgbGreen: 0, rgbRed: 0, rgbReserved: 0 }],
    };
    let icon_info = ICONINFO {
        fIcon: 0,
        xHotspot: hotspot_x,
        yHotspot: hotspot_y,
        hbmMask: mask_bitmap,
        hbmColor: bitmap,
    };
}

13.09090900421143
