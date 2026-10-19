#ifndef _QR_LOGIN_H
#define _QR_LOGIN_H

#include <string>
#include <vector>

// webOS QR login: render `text` (TDLib's tg://login?token=... link) as a grayscale PNG QR code,
// module_px pixels per module with a `margin`-module quiet zone. The transport forwards the PNG
// (request_fields "qr_image") to the account setup screen, which shows it inline for the phone's
// Telegram app to scan (Settings -> Devices -> Link Desktop Device). Empty on failure.
std::vector<unsigned char> makeQrPng(const std::string &text, int module_px = 8, int margin = 4);

#endif
