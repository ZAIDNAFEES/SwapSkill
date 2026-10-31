import UIKit
import Capacitor
import CallKit
import PushKit
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate, CXProviderDelegate {

    var window: UIWindow?
    static weak var shared: AppDelegate?

    var voipRegistry: PKPushRegistry?
    var callKitProvider: CXProvider?
    var callKitController: CXCallController?
    var currentCallUUID: UUID?
    var currentCallIdString: String?
    var currentVoipToken: String?
    var pendingCallAction: [String: Any]?
    var callIdToUUIDMap: [String: UUID] = [:]
    var uuidToCallIdMap: [UUID: String] = [:]
    var reportedCallIds = Set<String>()

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AppDelegate.shared = self

        // 1. Initialize CallKit Provider with video and generic caller handle support
        let providerConfig = CXProviderConfiguration(localizedName: "SwapSkill")
        providerConfig.supportsVideo = true
        providerConfig.maximumCallsPerCallGroup = 1
        providerConfig.supportedHandleTypes = [.generic]
        providerConfig.iconTemplateImageData = UIImage(named: "AppIcon")?.pngData()

        self.callKitProvider = CXProvider(configuration: providerConfig)
        self.callKitProvider?.setDelegate(self, queue: nil)
        self.callKitController = CXCallController()

        // 2. Initialize PushKit for native VoIP incoming calls
        self.voipRegistry = PKPushRegistry(queue: DispatchQueue.main)
        self.voipRegistry?.delegate = self
        self.voipRegistry?.desiredPushTypes = [.voIP]

        // Check if token was previously persisted
        self.currentVoipToken = UserDefaults.standard.string(forKey: "swapskill_voip_token")

        return true
    }

    // MARK: - PKPushRegistryDelegate

    func pushRegistry(_ registry: PKPushRegistry, didUpdate credentials: PKPushCredentials, for type: PKPushType) {
        let tokenParts = credentials.token.map { data in String(format: "%02.2hhx", data) }
        let tokenString = tokenParts.joined()
        self.currentVoipToken = tokenString
        UserDefaults.standard.set(tokenString, forKey: "swapskill_voip_token")
        NotificationCenter.default.post(name: NSNotification.Name("SwapSkillVoIPTokenUpdated"), object: tokenString)
        CallKitPlugin.sharedInstance?.notifyVoipTokenUpdated(token: tokenString)
        print("[PushKit] VoIP token registered: \(tokenString.prefix(12))...")
    }

    func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        self.currentVoipToken = nil
        UserDefaults.standard.removeObject(forKey: "swapskill_voip_token")
        print("[PushKit] VoIP token invalidated")
    }

    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        // Critical requirement by Apple: MUST report incoming call to CallKit immediately
        let dict = payload.dictionaryPayload
        let data = (dict["data"] as? [String: Any]) ?? dict

        let callId = (data["callId"] as? String) ?? UUID().uuidString
        let callerName = (data["callerName"] as? String) ?? "Skill Swap Partner"
        let hasVideo = (data["callType"] as? String) == "video"

        // Prevent duplicate CallKit calls for the same callId
        if self.reportedCallIds.contains(callId) {
            print("[CallKit] Call with id \(callId) already reported. Skipping duplicate.")
            completion()
            return
        }
        self.reportedCallIds.insert(callId)

        self.currentCallIdString = callId
        let uuid = self.callIdToUUIDMap[callId] ?? UUID()
        self.callIdToUUIDMap[callId] = uuid
        self.uuidToCallIdMap[uuid] = callId
        self.currentCallUUID = uuid

        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = hasVideo
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false

        print("[CallKit] Reporting new incoming call from \(callerName) (\(callId))")
        self.callKitProvider?.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("[CallKit] Error reporting incoming call: \(error.localizedDescription)")
            }
            completion()
        }
    }

    // MARK: - CXProviderDelegate

    func providerDidReset(_ provider: CXProvider) {
        self.currentCallUUID = nil
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        action.fulfill()
        let callId = self.currentCallIdString ?? self.currentCallUUID?.uuidString ?? ""
        self.pendingCallAction = ["action": "answer", "callId": callId, "timestamp": Date().timeIntervalSince1970]
        
        // Notify native bridge plugin directly
        CallKitPlugin.sharedInstance?.notifyCallAnswered(callId: callId)

        // When user answers from CallKit screen (even on lock screen), open app directly into active call
        if let url = URL(string: "swapskill://call/\(callId)?autoAccept=true") {
            DispatchQueue.main.async {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }
        NotificationCenter.default.post(name: NSNotification.Name("SwapSkillCallAnswered"), object: callId)
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        action.fulfill()
        let callId = self.currentCallIdString ?? self.currentCallUUID?.uuidString ?? ""
        self.pendingCallAction = ["action": "decline", "callId": callId, "timestamp": Date().timeIntervalSince1970]

        // Notify native bridge plugin directly
        CallKitPlugin.sharedInstance?.notifyCallDeclined(callId: callId)

        // When user declines or ends call from CallKit screen
        if let url = URL(string: "swapskill://call/\(callId)?action=decline") {
            DispatchQueue.main.async {
                UIApplication.shared.open(url, options: [:], completionHandler: nil)
            }
        }
        self.currentCallUUID = nil
        self.currentCallIdString = nil
        NotificationCenter.default.post(name: NSNotification.Name("SwapSkillCallEnded"), object: callId)
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        do {
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .allowBluetoothA2DP, .defaultToSpeaker])
            try audioSession.setActive(true)
        } catch {
            print("[CallKit] Failed to configure audio session: \(error)")
        }
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        do {
            try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
        } catch {}
    }

    // MARK: - Public CallKit Controls

    func endCallKitCall(uuidString: String?) {
        var targetUuid = self.currentCallUUID
        if let cid = uuidString {
            if let mapped = self.callIdToUUIDMap[cid] {
                targetUuid = mapped
            } else if let parsed = UUID(uuidString: cid) {
                targetUuid = parsed
            }
        }
        guard let uuid = targetUuid else { return }

        let endAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endAction)
        self.callKitController?.request(transaction) { error in
            if let error = error {
                print("[CallKit] Error requesting end call: \(error.localizedDescription)")
            }
        }
        if let cid = uuidString {
            self.reportedCallIds.remove(cid)
            self.callIdToUUIDMap.removeValue(forKey: cid)
        }
        self.currentCallUUID = nil
        self.currentCallIdString = nil
    }

    func reportCallConnected(uuidString: String?) {
        var targetUuid = self.currentCallUUID
        if let cid = uuidString {
            if let mapped = self.callIdToUUIDMap[cid] {
                targetUuid = mapped
            } else if let parsed = UUID(uuidString: cid) {
                targetUuid = parsed
            }
        }
        guard let uuid = targetUuid else { return }
        self.callKitProvider?.reportOutgoingCall(with: uuid, connectedAt: Date())
    }

    // MARK: - Application Lifecycle & URLs

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {}

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
