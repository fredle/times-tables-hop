import SwiftUI
import UIKit
import WebKit

/// Hosts the web game (the files in the bundled `public` folder) and connects
/// it to on-device speech recognition and haptics.
struct GameWebView: UIViewRepresentable {
    func makeCoordinator() -> GameBridge {
        GameBridge()
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        config.userContentController.add(context.coordinator, name: "voice")

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        webView.scrollView.bounces = false
        context.coordinator.attach(webView)

        if let url = URL(string: "\(BundleSchemeHandler.scheme)://game/index.html") {
            webView.load(URLRequest(url: url))
        }
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Receives `{cmd: ...}` messages from the page and sends speech results back
/// by calling `window.__nativeVoice` in the page.
@MainActor
final class GameBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private let listener = SpeechListener()

    func attach(_ webView: WKWebView) {
        self.webView = webView
        listener.onResult = { [weak self] text, turn in
            self?.call("onResult", [text, turn])
        }
        listener.onState = { [weak self] state, detail in
            self?.call("onState", [state, detail ?? ""])
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let turn = (body["turn"] as? NSNumber)?.intValue ?? 0
        switch cmd {
        case "start":
            listener.start(turn: turn, hints: body["hints"] as? [String] ?? [])
        case "reset":
            listener.reset(turn: turn)
        case "stop":
            listener.stop()
        case "haptic":
            haptic(body["kind"] as? String ?? "")
        default:
            break
        }
    }

    private func call(_ function: String, _ arguments: [Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: arguments),
              let json = String(data: data, encoding: .utf8) else { return }
        let script = "window.__nativeVoice && window.__nativeVoice.\(function).apply(null, \(json));"
        webView?.evaluateJavaScript(script, completionHandler: nil)
    }

    private func haptic(_ kind: String) {
        switch kind {
        case "hop":
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "splat":
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        case "win":
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        default:
            UIImpactFeedbackGenerator(style: .rigid).impactOccurred()
        }
    }
}

/// Serves the bundled `public` folder at `hop://game/...`. A custom scheme
/// (rather than file URLs) lets the page load its JavaScript modules.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "hop"

    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "svg": "image/svg+xml",
        "png": "image/png",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }

        let root = Bundle.main.bundleURL.appendingPathComponent("public", isDirectory: true).standardizedFileURL
        let file = root.appendingPathComponent(String(path.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }

        let mime = BundleSchemeHandler.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = [
            "Content-Type": mime,
            "Content-Length": String(data.count),
            "Cache-Control": "no-cache",
        ]
        guard let response = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers) else {
            urlSchemeTask.didFailWithError(URLError(.unknown))
            return
        }
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
