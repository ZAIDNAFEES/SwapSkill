import Foundation
import Capacitor

/**
 * Capacitor plugin bridging native iOS PushKit / CallKit with the web application.
 */
@objc(CallKitPlugin)
public class CallKitPlugin: CAPPlugin, CAPBridgedPlugin {
    public static weak var sharedInstance: CallKitPlugin?

    public let identifier = "CallKitPlugin"
    public let jsName = "CallKitPlugin"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getVoipToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endCall", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "reportConnected", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPendingCallAction", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearPendingCallAction", returnType: CAPPluginReturnPromise)
    ]

    override public func load() {
        super.load()
        CallKitPlugin.sharedInstance = self
    }

    @objc func getVoipToken(_ call: CAPPluginCall) {
        let token = AppDelegate.shared?.currentVoipToken ?? UserDefaults.standard.string(forKey: "swapskill_voip_token")
        call.resolve([
            "voipToken": token ?? ""
        ])
    }

    @objc func endCall(_ call: CAPPluginCall) {
        let callId = call.getString("callId")
        AppDelegate.shared?.endCallKitCall(uuidString: callId)
        call.resolve(["ended": true])
    }

    @objc func reportConnected(_ call: CAPPluginCall) {
        let callId = call.getString("callId")
        AppDelegate.shared?.reportCallConnected(uuidString: callId)
        call.resolve(["connected": true])
    }

    @objc func getPendingCallAction(_ call: CAPPluginCall) {
        if let pending = AppDelegate.shared?.pendingCallAction {
            AppDelegate.shared?.pendingCallAction = nil
            call.resolve([
                "hasAction": true,
                "action": pending["action"] as? String ?? "",
                "callId": pending["callId"] as? String ?? ""
            ])
        } else {
            call.resolve([
                "hasAction": false,
                "action": "",
                "callId": ""
            ])
        }
    }

    @objc func clearPendingCallAction(_ call: CAPPluginCall) {
        AppDelegate.shared?.pendingCallAction = nil
        call.resolve(["cleared": true])
    }

    public func notifyCallAnswered(callId: String) {
        self.notifyListeners("callAnswered", data: ["callId": callId])
    }

    public func notifyCallDeclined(callId: String) {
        self.notifyListeners("callDeclined", data: ["callId": callId])
    }

    public func notifyVoipTokenUpdated(token: String) {
        self.notifyListeners("voipTokenUpdated", data: ["voipToken": token])
    }
}
