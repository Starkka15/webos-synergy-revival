/*global OAuth2, AccountCreds, Acl, Config, console */
/* pollDeviceLogin - one poll of a Device Authorization Grant started by startDeviceLogin.
 * Answers { pending: true, slowDown } until the user has finished signing in on the other
 * device, then the same account-create result exchangeCode gives (username, alias,
 * credentials). The auth app drives the polling at the interval startDeviceLogin returned,
 * passing the device code each time: the service is idle-killed between polls, so it keeps
 * no state of its own. Gated to the auth app, since a finished poll carries the tokens.
 */
function PollDeviceLoginCommandAssistant() {}

PollDeviceLoginCommandAssistant.prototype = {
	allowedAppIds: (typeof Config !== "undefined" && Config.AUTH_APP_IDS) || [],

	run: function (future) {
		if (!Acl.enforce(this, future)) { return; }
		var args = this.controller.args || {};
		if (!args.deviceCode) {
			future.setException({ returnValue: false, errorCode: "MISSING_DEVICE_CODE" });
			return;
		}
		var p = OAuth2.pollDevice(args.deviceCode);
		p.then(this, function () {
			var t;
			try { t = p.result; }
			catch (e) { future.setException(e); return; }
			if (t.pending) {
				future.result = t;
				return;
			}
			var acct = AccountCreds.fromTokens(t);
			acct.then(this, function () { future.result = acct.result; });
		});
	}
};
