#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(CallKitPlugin, "CallKitPlugin",
    CAP_PLUGIN_METHOD(getVoipToken, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(endCall, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reportConnected, CAPPluginReturnPromise);
)
