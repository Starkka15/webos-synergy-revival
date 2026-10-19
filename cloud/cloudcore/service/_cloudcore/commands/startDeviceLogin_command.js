/*global OAuth2, Acl, Config, console */
/* startDeviceLogin - begins an OAuth2 Device Authorization Grant (RFC 8628). Returns the short
 * user code and the page to enter it on (another device: phone/PC), plus the device code the
 * auth app hands back to pollDeviceLogin. Only for connectors whose config sets DEVICE_CODE_URL;
 * the rest answer NOT_SUPPORTED (or have no such method), and com.palm.app.cloud-auth falls back
 * to the embedded browser sign-in. GENERIC across all connectors.
 */
function StartDeviceLoginCommandAssistant() {}

StartDeviceLoginCommandAssistant.prototype = {
	allowedAppIds: (typeof Config !== "undefined" && Config.AUTH_APP_IDS) || [],

	run: function (future) {
		if (!Acl.enforce(this, future)) { return; }
		var d = OAuth2.startDevice();
		d.then(this, function () {
			try { future.result = d.result; }
			catch (e) { future.setException(e); }
		});
	}
};
