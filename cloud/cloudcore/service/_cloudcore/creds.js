/*global IMPORTS, Adapter, Config, console */
/* creds.js - resolve/persist Google Drive account credentials from the service side.
 *
 * A consumer app can pass raw { credentials:{common:{...}} }, OR just an { accountId }
 * and let the service read the stored tokens itself. The latter keeps tokens out of the
 * app and lets the service persist a refreshed token straight back to the account.
 * Requires com.palm.service.gdrive in the template read+writePermissions (the accounts
 * service permission-checks readCredentials/writeCredentials against those lists).
 */
var Foundations = IMPORTS.foundations;
var Future = Foundations.Control.Future;
var PalmCall = Foundations.Comms.PalmCall;

var AccountCreds = {
	// resolve(args) -> Future resolving to the `common` credentials object.
	resolve: function (args) {
		var f = new Future();
		if (args.credentials && args.credentials.common && args.credentials.common.accessToken) {
			f.result = args.credentials.common;
			return f;
		}
		if (!args.accountId) {
			f.setException({ returnValue: false, errorCode: "NO_CREDENTIALS",
				detail: "pass credentials or accountId" });
			return f;
		}
		// Credentials are stored per named key; exchangeCode saved them under "common"
		// (accounts saveCredentials stores each top-level key of the credentials object).
		var call = PalmCall.call("palm://com.palm.service.accounts/", "readCredentials",
			{ accountId: args.accountId, name: "common" });
		f.now(this, function () { return call; });
		f.then(this, function () {
			var r = f.result;
			// KeyStore may return the value directly, or wrapped as {credentials:...}, or
			// still nested under {common:...} - normalise all three.
			var c = (r && r.credentials) || r || {};
			if (c && c.common) { c = c.common; }
			if (!c || !c.accessToken) {
				f.setException({ returnValue: false, errorCode: "NO_STORED_CREDENTIALS", detail: r });
				return;
			}
			f.result = c;
		});
		return f;
	},

	// fromTokens(t) -> Future resolving to the account-create result for a fresh OAuth2 token
	// result: credentials in the shape the account DB stores, PLUS a username, because
	// accounts/handlers/create.js does Assert.require(args.username) and refuses to create the
	// account without one. The identity fetch may fail (still create the account with a
	// fallback name) - we already have valid tokens. Shared by exchangeCode + pollDeviceLogin.
	fromTokens: function (t) {
		var f = new Future();
		var common = {
			accessToken:  t.accessToken,
			refreshToken: t.refreshToken,
			expiresAt:    Date.now() + (t.expiresIn * 1000)
		};
		var info = Adapter.getAccountInfo(common);
		info.then(this, function () {
			var u = {};
			try { u = (info.result && info.result.user) || {}; } catch (e) { u = {}; }
			f.result = {
				returnValue: true,
				username:    u.emailAddress || (Config && Config.DISPLAY_NAME) || "Cloud account",
				alias:       u.displayName || undefined,
				credentials: { common: common }
			};
		});
		return f;
	},

	// Persist refreshed tokens back to the account (best-effort; only when we own accountId).
	save: function (accountId, common) {
		if (!accountId || !common) { var d = new Future(); d.result = { returnValue: false }; return d; }
		return PalmCall.call("palm://com.palm.service.accounts/", "writeCredentials",
			{ accountId: accountId, name: "common", credentials: common });
	}
};

if (typeof exports !== "undefined") { exports.AccountCreds = AccountCreds; }
