// Telegram account custom-validator UI (webOS Synergy / Accounts customUI).
//
// Loaded as a cross-app IFRAME by the Accounts framework (entry-add.js ->
// Accounts.crossAppUI -> CrossAppUI). It is an Enyo 0.10 app that returns the
// account to the caller via enyo.CrossAppResult.sendResult(...):
//
//     { returnValue:true, username, credentials, config, template, templateId }
//
// The framework then calls palm://com.palm.service.accounts/createAccount. On
// creation the MESSAGING/IM capability's onEnabled fires -> imlibpurpletransport
// logs the account in via prpl-telegram.
//
// --- TWO WAYS TO SIGN IN ------------------------------------------------------
// Telegram has no web login: auth is an in-band MTProto handshake the prpl runs itself.
//
// 1. QR CODE (default, "create-after-confirm", same transport channel as Discord's):
//    we ask the transport to run a PENDING prpl-telegram login with the "QRLOGIN"
//    sentinel password (com.palm.imlibpurple/startQRLogin). The prpl asks TDLib for a
//    QR login (requestQrCodeAuthentication) and hands each tg://login link to the
//    transport as a QR image, which we poll (getAuthChallenge) and show INLINE. The user
//    scans it in the phone's Telegram app (Settings -> Devices -> Link Desktop Device).
//    If the account has a 2-step verification password, the prpl asks for it over the
//    same channel's input slot (kind "captcha", captchaService "telegram-2fa", hint in
//    captchaSitekey) and we answer with submitAuthInput(action "captcha"). Once TDLib is
//    signed in the transport reports state=confirmed and ONLY THEN do we sendResult(),
//    creating the account with "QRLOGIN" as its password; the transport adopts the
//    already-connected login, and the TDLib database holds the session from then on.
//
// 2. LOGIN CODE (fallback): the original phone-number flow. We create the account
//    straight away with the "logincode" sentinel password (it must be non-empty:
//    imlibpurpletransport's getCredentialsResult rejects an EMPTY password as
//    AcctMgr_Credentials_Not_Found). The transport implements no request_input, so the
//    prpl asks for the code (and a 2FA password) through a "Telegram" chat in the
//    Messaging app, and takes the user's reply as the answer (PATCH-AUTH.md).
//
// --- TRANSPORT LUNA CONTRACT (com.palm.imlibpurple) --------------------------
//   startQRLogin     {serviceName, username}                 -> {returnValue}
//   getAuthChallenge {serviceName, username}                 -> {returnValue, state, kind?,
//                       qrImage?/*data-URI*/, captchaService?, captchaSitekey?, captchaRqData?,
//                       message?, token?}
//                    state in: waiting | scanned | confirmed | expired | failed
//   submitAuthInput  {serviceName, username, action, value?} action in: captcha | refresh | cancel
// Polled, not subscribed: luna subscription push is unreliable inside the accounts
// customUI iframe (see the Discord and Teams validators).

enyo.kind({
    name: "Validator",
    kind: enyo.VFlexBox,
    className: "enyo-bg",

    SERVICE_NAME: "type_telegram",
    QR_POLL_MS: 2000,
    // TDLib replaces the link itself every ~30s, so there is no code expiry to wait out;
    // this only bounds how long the screen waits for the phone.
    QR_TIMEOUT_MS: 300000,

    components: [
        { kind: "Toolbar", className: "enyo-toolbar-light accounts-header", pack: "center", components: [
            { kind: "Image", src: "images/header-icon.png" },
            { kind: "Control", name: "title", content: "Sign In"}
        ]},
        { className: "accounts-header-shadow" },

        // Transport auth channel (QR). Polled, not subscribed (see header note).
        { name: "startQR", kind: "PalmService", service: "palm://com.palm.imlibpurple/",
          method: "startQRLogin", onSuccess: "qrStarted", onFailure: "qrStartFailed" },
        { name: "getChallenge", kind: "PalmService", service: "palm://com.palm.imlibpurple/",
          method: "getAuthChallenge", onSuccess: "gotChallenge", onFailure: "challengeError" },
        { name: "submitAuth", kind: "PalmService", service: "palm://com.palm.imlibpurple/",
          method: "submitAuthInput" },

        { kind: "Scroller", flex: 1, components: [
            // -------- Account entry --------
            { name: "entryBox", className: "box-center", components: [
                { kind: "RowGroup", caption: "DISPLAY NAME (OPTIONAL)", className: "accounts-group", components: [
                    { kind: "Input", name: "displayName", hint: "e.g. My Telegram", spellcheck: false,
                      autocorrect: false, autoWordComplete: false }
                ]},
                { kind: "RowGroup", caption: "PHONE NUMBER", className: "accounts-group", components: [
                    { kind: "Input", name: "username", hint: "+15551234567", spellcheck: false,
                      autocorrect: false, autoWordComplete: false, autoCapitalize: "lowercase",
                      oninput: "validateInput", onkeydown: "checkForEnter" }
                ]},
                { name: "errorBox", kind: "HFlexBox", showing: false, align: "center", className: "error-box", components: [
                    { name: "errorMessage", className: "enyo-text-error", flex: 1 }
                ]},
                { className: "accounts-body-text", style: "padding: 12px 16px; line-height: 1.4;", allowHtml: true,
                  content: "Enter your phone number in <b>international format</b> (with country code, e.g. +15551234567), then tap <b>Sign In</b>. A QR code appears right here: on your phone open <b>Telegram → Settings → Devices → Link Desktop Device</b> and scan it." },
                { kind: "ActivityButton", name: "signInButton", caption: "Sign In", disabled: true, active: false,
                  className: "enyo-button-dark accounts-btn", onclick: "performSignIn" },
                { className: "accounts-body-text", style: "padding: 14px 16px 4px; line-height: 1.4; opacity: 0.7;", allowHtml: true,
                  content: "No other device signed in to Telegram? Use a login code instead: Telegram sends it by app or SMS, and you finish signing in from the <b>Messaging</b> app by replying to the <b>Telegram</b> chat with the code (and your 2-step password, if you use one)." },
                { kind: "Button", name: "codeButton", caption: "Use a login code instead", disabled: true,
                  className: "accounts-btn", onclick: "performCodeSignIn" },

                // Standard framework Remove Account (with keep-data option); shown only when editing an
                // existing account; sits directly below the sign-in buttons. init() with no capability => full delete.
                { name: "removeAccountButton", kind: "Accounts.RemoveAccount", className: "accounts-btn",
                  showing: false, style: "padding-top:6px;", onAccountsRemove_Done: "removeDone" }
            ]},

            // -------- Inline QR view (shown during QR sign-in) --------
            { name: "qrBox", showing: false, className: "box-center", style: "text-align:center;", components: [
                { name: "qrTitle", className: "accounts-body-text", style: "padding:14px 16px 4px; font-size:20px;",
                  content: "Sign in to Telegram" },
                { name: "qrStatus", className: "accounts-body-text", style: "padding:2px 16px 10px; opacity:0.8; line-height:1.4;",
                  content: "Preparing your QR code…" },
                { name: "qrImageWrap", showing: false, style: "background:#fff; padding:14px; border-radius:10px; width:230px; height:230px; margin:10px auto; text-align:center;",
                  components: [
                    { name: "qrImg", kind: "Image", style: "display:block; width:230px; height:230px; margin:0 auto; image-rendering:pixelated; -ms-interpolation-mode:nearest-neighbor;" }
                ]},
                { name: "qrHelp", className: "accounts-body-text", style: "padding:8px 24px; opacity:0.6; line-height:1.4;",
                  content: "On your phone: Telegram → Settings → Devices → Link Desktop Device, then point it here." },

                // -------- 2-step verification password (asked after the scan) --------
                { name: "passwordBox", showing: false, style: "text-align:left;", components: [
                    { kind: "RowGroup", caption: "2-STEP VERIFICATION PASSWORD", className: "accounts-group", components: [
                        { kind: "PasswordInput", name: "password", hint: "password", spellcheck: false,
                          autocorrect: false, autoWordComplete: false, onkeydown: "passwordKeyDown" }
                    ]},
                    { name: "passwordHint", className: "accounts-body-text", style: "padding:4px 16px 8px; opacity:0.7; line-height:1.4;" },
                    { kind: "Button", name: "passwordButton", caption: "Continue",
                      className: "enyo-button-dark accounts-btn", onclick: "submitPassword" }
                ]},

                { name: "qrRefreshButton", showing: false, kind: "Button", caption: "Try again",
                  className: "accounts-btn", onclick: "refreshQR" }
            ]}
        ]},
        { kind: "Toolbar", className: "enyo-toolbar-light", components: [
            { kind: "Button", name: "cancelButton", caption: "Cancel", className: "accounts-toolbar-btn", onclick: "cancel" }
        ]},
        { kind: "CrossAppResult" }
    ],

    create: function() {
        this.inherited(arguments);
        this._qrActive = false;
        this.handleLaunch(enyo.windowParams || {});
    },

    handleLaunch: function(params) {
        this.params = params || {};
        this.template = null;
        if (params.template && params.template.templateId === "com.palm.telegram") {
            this.template = params.template;
        } else if (params.allTemplates) {
            for (var i = 0; i < params.allTemplates.length; i++) {
                if (params.allTemplates[i].templateId === "com.palm.telegram") {
                    this.template = params.allTemplates[i];
                    break;
                }
            }
        }
        // Re-auth of an existing account also offers Remove (this flow bypasses the framework
        // account-detail view, the only other place with a Remove button).
        this.accountId = (params.account && (params.account._id || params.account.id)) || params.accountId || null;
        // Editing an existing account -> offer the standard Remove Account button (with keep-data option).
        // No capability passed => the whole account is deleted (not just one capability).
        if (this.accountId && params.account) {
            this.$.removeAccountButton.init(params.account);
            this.$.removeAccountButton.show();
        }
        if (params.account && params.account.username) {
            this.$.username.setValue(params.account.username);
            this.$.username.setDisabled(true);
            if (params.account.alias && params.account.alias !== params.account.username) {
                this.$.displayName.setValue(params.account.alias);
            }
        }
        this.validateInput();
    },

    getAlias: function(phone) {
        var n = (this.$.displayName.getValue() || "").replace(/^\s+|\s+$/g, "");
        return n || phone;
    },

    // Accept a leading + and 6-15 digits (E.164-ish). We keep it permissive; the
    // prpl does the authoritative validation on connect.
    normalizePhone: function(v) {
        v = (v || "").replace(/[^\d+]/g, "");
        if (v.indexOf("+") > 0) { v = "+" + v.replace(/\+/g, ""); }
        return v;
    },

    validateInput: function() {
        var v = this.normalizePhone(this.$.username.getValue());
        var ok = /^\+?\d{6,15}$/.test(v);
        this.$.signInButton.setDisabled(!ok);
        this.$.codeButton.setDisabled(!ok);
    },

    checkForEnter: function(inSender, e) {
        if (e && e.keyCode === 13 && !this.$.signInButton.getDisabled()) {
            this.$.username.forceBlur();
            this.performSignIn();
        }
    },

    showError: function(msg) {
        this.$.errorMessage.setContent(msg || "");
        if (msg) { this.$.errorBox.show(); } else { this.$.errorBox.hide(); }
    },

    performSignIn: function() {
        var phone = this.normalizePhone(this.$.username.getValue());
        if (!phone) { return; }
        this.showError("");
        this.$.signInButton.setActive(true);
        this.$.signInButton.setDisabled(true);
        this.$.codeButton.setDisabled(true);
        this.startQRSignIn(phone);
    },

    // Fallback: create the account now with the "logincode" sentinel (see header); the
    // code handshake then happens in the Messaging app's "Telegram" chat.
    performCodeSignIn: function() {
        var phone = this.normalizePhone(this.$.username.getValue());
        if (!phone) { return; }
        this.finishWithCredential(phone, "logincode");
    },

    // ---- create-after-confirm QR flow ---------------------------------------

    startQRSignIn: function(phone) {
        this._qrUser = phone;
        this._qrActive = true;
        this._qrPollCount = 0;
        this._qrImage = null;
        this._pwPrompt = null;
        this.$.entryBox.hide();
        this.$.qrBox.show();
        this.$.qrTitle.setContent("Sign in to Telegram");
        this.$.qrImageWrap.hide();
        this.$.qrHelp.show();
        this.$.passwordBox.hide();
        this.$.qrRefreshButton.hide();
        this.$.qrStatus.setContent("Preparing your QR code…");
        this.$.startQR.call({ serviceName: this.SERVICE_NAME, username: phone });
    },

    qrStarted: function() {
        if (!this._qrActive) { return; }
        this.startQRPoll();
    },

    qrStartFailed: function(inSender, err) {
        this.log("telegram: startQRLogin failed: " + enyo.json.stringify(err));
        this.abortQR("Couldn't start QR sign-in. Please try again.");
    },

    startQRPoll: function() {
        this.stopQRPoll();
        var self = this;
        this._qrPoll = window.setInterval(function () { self.pollChallenge(); }, this.QR_POLL_MS);
        this.pollChallenge();   // immediate first poll
    },

    stopQRPoll: function() {
        if (this._qrPoll) { window.clearInterval(this._qrPoll); this._qrPoll = null; }
    },

    pollChallenge: function() {
        if (!this._qrActive) { this.stopQRPoll(); return; }
        this._qrPollCount++;
        // Not while the user is typing their password: they set the pace there.
        if (!this.$.passwordBox.getShowing() && this._qrPollCount * this.QR_POLL_MS > this.QR_TIMEOUT_MS) {
            this.qrExpired("Sign-in timed out.");
            return;
        }
        this.$.getChallenge.call({ serviceName: this.SERVICE_NAME, username: this._qrUser });
    },

    gotChallenge: function(inSender, resp) {
        if (!this._qrActive) { return; }
        resp = resp || {};
        var state = resp.state;

        // The phone approved the scan and the account has a 2-step verification password:
        // the prpl asks for it over the captcha slot. captchaRqData numbers the prompts.
        if (resp.kind === "captcha" && resp.captchaService === "telegram-2fa") {
            if (state === "waiting" && resp.captchaRqData !== this._pwPrompt) {
                this.showPasswordPrompt(resp.captchaRqData, resp.captchaSitekey);
            }
            if (state === "waiting" || state === "scanned") { return; }
        }

        // TDLib replaces the link about every 30s; always show the newest code.
        if (resp.qrImage && resp.qrImage !== this._qrImage) {
            this._qrImage = resp.qrImage;
            this.$.qrImg.setSrc(resp.qrImage);
            this.$.qrImageWrap.show();
        }
        switch (state) {
            case "waiting":
                if (this._qrImage && !this._pwPrompt) {
                    this.$.qrStatus.setContent("Scan this code with Telegram on your phone.");
                }
                break;
            case "scanned":
                this.$.qrStatus.setContent("Scanned — finishing sign-in…");
                break;
            case "confirmed":
                this.stopQRPoll();
                this._qrActive = false;
                this.$.passwordBox.hide();
                this.$.qrStatus.setContent("Signed in! Finishing setup…");
                // The session now lives in the TDLib database; the sentinel tells the prpl
                // to use QR (never the phone code) if it ever has to sign in again.
                this.finishWithCredential(this._qrUser, resp.token || "QRLOGIN");
                break;
            case "expired":
                this.qrExpired("That code expired.");
                break;
            case "failed":
                this.abortQR(resp.message || "Telegram sign-in failed.");
                break;
            default:
                // no challenge yet / unknown -> keep polling
                break;
        }
    },

    challengeError: function(inSender, err) {
        // Transient luna error -> keep polling; only surface if it persists past timeout.
        this.log("telegram: getAuthChallenge error: " + enyo.json.stringify(err));
    },

    // ---- 2-step verification password ----------------------------------------

    showPasswordPrompt: function(prompt, hint) {
        this._pwPrompt = prompt;
        this.$.qrTitle.setContent("Enter your password");
        this.$.qrStatus.setContent("Your Telegram account has 2-step verification turned on.");
        this.$.qrImageWrap.hide();
        this.$.qrHelp.hide();
        this.$.passwordHint.setContent(hint || "");
        this.$.password.setValue("");
        this.$.passwordButton.setDisabled(false);
        this.$.passwordBox.show();
        this.$.password.forceFocus();
    },

    passwordKeyDown: function(inSender, e) {
        if (e && e.keyCode === 13) {
            this.submitPassword();
        }
    },

    submitPassword: function() {
        var pw = this.$.password.getValue();
        if (!pw || this.$.passwordButton.getDisabled()) { return; }
        this.$.password.forceBlur();
        this.$.passwordButton.setDisabled(true);
        this.$.qrStatus.setContent("Checking password…");
        this._qrPollCount = 0;
        this.$.submitAuth.call({ serviceName: this.SERVICE_NAME, username: this._qrUser,
                                 action: "captcha", value: pw });
        // keep polling: a wrong password comes back as a new prompt, success as state=confirmed
    },

    // ---- end of the QR flow ----------------------------------------------------

    qrExpired: function(msg) {
        this.stopQRPoll();
        this.$.qrStatus.setContent(msg + " Tap Try again for a new code.");
        this.$.qrImageWrap.hide();
        this.$.passwordBox.hide();
        this.$.qrRefreshButton.show();
    },

    refreshQR: function() {
        this.$.qrRefreshButton.hide();
        this.$.qrImageWrap.hide();
        this.$.passwordBox.hide();
        this.$.qrHelp.show();
        this.$.qrTitle.setContent("Sign in to Telegram");
        this._qrImage = null;
        this._pwPrompt = null;
        this._qrPollCount = 0;
        this._qrActive = true;
        this.$.qrStatus.setContent("Getting a new QR code…");
        this.$.submitAuth.call({ serviceName: this.SERVICE_NAME, username: this._qrUser, action: "refresh" });
        this.startQRPoll();
    },

    // Give up on the QR flow: tell the transport to tear down the pending login and
    // return to account entry so the user can retry or use a login code.
    abortQR: function(msg) {
        this.stopQRPoll();
        this._qrActive = false;
        if (this._qrUser) {
            this.$.submitAuth.call({ serviceName: this.SERVICE_NAME, username: this._qrUser, action: "cancel" });
        }
        this.$.qrBox.hide();
        this.$.entryBox.show();
        this.$.signInButton.setActive(false);
        this.validateInput();
        this.showError(msg);
    },

    finishWithCredential: function(phone, secret) {
        var result = {
            returnValue: true,
            username: phone,
            alias: this.getAlias(phone),
            credentials: { common: { password: secret } },
            config: {},
            template: this.template || { templateId: "com.palm.telegram" },
            templateId: "com.palm.telegram"
        };
        this.$.crossAppResult.sendResult(result);
    },

    // Fired by Accounts.RemoveAccount (onAccountsRemove_Done) once the framework has handled the confirm
    // dialog (incl. the keep-data option) and the deleteAccount call. Return to the Accounts app.
    removeDone: function() {
        this.$.crossAppResult.sendResult({ returnValue: false });
    },
    cancel: function() {
        this.stopQRPoll();
        if (this._qrActive && this._qrUser) {
            // Cancel the pending login so it doesn't linger in the transport.
            this.$.submitAuth.call({ serviceName: this.SERVICE_NAME, username: this._qrUser, action: "cancel" });
        }
        this._qrActive = false;
        this.$.crossAppResult.sendResult({ returnValue: false });
    }
});
