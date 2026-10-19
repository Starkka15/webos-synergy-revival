#include "qr-login.h"
#include <qrencode.h>
#include <zlib.h>

// PNG chunk: big-endian length, type, data, CRC32 over type+data.
static void pngChunk(std::vector<unsigned char> &out, const char *type, const unsigned char *data, size_t len)
{
    const unsigned char lenBytes[4] = {(unsigned char)(len >> 24), (unsigned char)(len >> 16),
                                       (unsigned char)(len >> 8), (unsigned char)len};
    out.insert(out.end(), lenBytes, lenBytes + 4);
    size_t start = out.size();
    out.insert(out.end(), type, type + 4);
    if (data && len)
        out.insert(out.end(), data, data + len);
    uLong crc = crc32(crc32(0L, Z_NULL, 0), out.data() + start, 4 + len);
    const unsigned char crcBytes[4] = {(unsigned char)(crc >> 24), (unsigned char)(crc >> 16),
                                       (unsigned char)(crc >> 8), (unsigned char)crc};
    out.insert(out.end(), crcBytes, crcBytes + 4);
}

// Same encoding as the Discord prpl's qrcode_png_output (discord_rsa.c): 8-bit grayscale, filter
// type 0, one IDAT. The accounts webview (2011 WebKit) renders PNG data URIs; nothing fancier needed.
std::vector<unsigned char> makeQrPng(const std::string &text, int module_px, int margin)
{
    std::vector<unsigned char> png;
    QRcode *qr = QRcode_encodeString(text.c_str(), 0, QR_ECLEVEL_L, QR_MODE_8, 1);
    if (!qr)
        return png;

    const int    qw     = qr->width;
    const int    dim    = (qw + margin * 2) * module_px;
    const size_t rowLen = 1 + (size_t)dim;   // filter byte + pixels
    std::vector<unsigned char> raw(rowLen * dim);
    for (int y = 0; y < dim; y++) {
        unsigned char *row = &raw[(size_t)y * rowLen];
        row[0] = 0;
        int qy = y / module_px - margin;
        for (int x = 0; x < dim; x++) {
            int qx = x / module_px - margin;
            bool dark = qx >= 0 && qx < qw && qy >= 0 && qy < qw && (qr->data[qy * qw + qx] & 1);
            row[1 + x] = dark ? 0x00 : 0xFF;
        }
    }
    QRcode_free(qr);

    uLongf compLen = compressBound(raw.size());
    std::vector<unsigned char> comp(compLen);
    if (compress(comp.data(), &compLen, raw.data(), raw.size()) != Z_OK)
        return png;

    static const unsigned char signature[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    png.insert(png.end(), signature, signature + 8);
    const unsigned char ihdr[13] = {
        (unsigned char)(dim >> 24), (unsigned char)(dim >> 16), (unsigned char)(dim >> 8), (unsigned char)dim,
        (unsigned char)(dim >> 24), (unsigned char)(dim >> 16), (unsigned char)(dim >> 8), (unsigned char)dim,
        8,  // bit depth
        0,  // grayscale
        0, 0, 0
    };
    pngChunk(png, "IHDR", ihdr, sizeof(ihdr));
    pngChunk(png, "IDAT", comp.data(), compLen);
    pngChunk(png, "IEND", nullptr, 0);
    return png;
}
