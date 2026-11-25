import SwiftUI

// "What would make this better?" - a button that opens a sheet for a note to
// the developer, sent anonymously to app-factory's feedback server.
// Factory-owned: keep this file as-is.
//
// The server URL comes from the FeedbackURL Info.plist key (project.yml),
// set at scaffold time from app-factory's config.json feedbackUrl. When it
// was empty, FeedbackButton draws nothing.
//
// Apps for children pass grownUpsOnly: true. The button then reads "For
// grown-ups" and the sheet opens behind a sum a child can't do (two two-digit
// numbers multiplied), as App Review expects of a parental gate.

enum Feedback {
    static let app = "times-tables-hop"
    static let maxChars = 2000

    static var endpoint: URL? {
        guard let s = Bundle.main.object(forInfoDictionaryKey: "FeedbackURL") as? String,
              s.hasPrefix("http") else { return nil }
        return URL(string: s)
    }

    static func send(_ text: String) async throws {
        guard let endpoint = endpoint else { throw URLError(.badURL) }
        var request = URLRequest(url: endpoint, timeoutInterval: 15)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let body: [String: String] = ["app": app, "version": version, "platform": "ios", "text": text]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }

    /// Two numbers from 13 to 29 for the grown-ups' gate.
    static func gateNumbers() -> (Int, Int) {
        (Int.random(in: 13...29), Int.random(in: 13...29))
    }

    /// Whether `answer` is a times b, allowing spaces and thousands commas.
    static func gatePasses(_ a: Int, _ b: Int, _ answer: String) -> Bool {
        let digits = answer.filter { !$0.isWhitespace && $0 != "," }
        return Int(digits) == a * b
    }
}

/// Put this in a toolbar or settings screen:
/// `.toolbar { ToolbarItem(placement: .topBarTrailing) { FeedbackButton() } }`
@MainActor
struct FeedbackButton: View {
    var grownUpsOnly = false
    @State private var showing = false

    var body: some View {
        if Feedback.endpoint != nil {
            Button {
                showing = true
            } label: {
                Label(grownUpsOnly ? "For grown-ups" : "What would make this better?", systemImage: "lightbulb")
            }
            .sheet(isPresented: $showing) {
                FeedbackSheet(grownUpsOnly: grownUpsOnly)
            }
        }
    }
}

@MainActor
struct FeedbackSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var unlocked: Bool
    @State private var gate = Feedback.gateNumbers()
    @State private var gateAnswer = ""
    @State private var gateWrong = false
    @State private var text = ""
    @State private var sending = false
    @State private var sent = false
    @State private var failure: String?
    @FocusState private var focused: Bool

    init(grownUpsOnly: Bool = false) {
        _unlocked = State(initialValue: !grownUpsOnly)
    }

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        NavigationStack {
            Form {
                if !unlocked {
                    Section {
                        Text("What is \(gate.0) × \(gate.1)?")
                        TextField("Answer", text: $gateAnswer)
                            .keyboardType(.numberPad)
                            .focused($focused)
                    } header: {
                        Text("For grown-ups")
                    } footer: {
                        Text(gateWrong ? "That's not it. Here's another one." : "This is for grown-ups. Answer this first.")
                    }
                } else if sent {
                    Section {
                        Text("Thank you. Every note is read.")
                    }
                } else {
                    Section {
                        TextEditor(text: $text)
                            .frame(minHeight: 140)
                            .focused($focused)
                            .disabled(sending)
                            .onChange(of: text) { _, newValue in
                                if newValue.count > Feedback.maxChars {
                                    text = String(newValue.prefix(Feedback.maxChars))
                                }
                            }
                    } footer: {
                        Text("Something missing, confusing or annoying? Tell the developer. Only your note and the app version are sent, never your name or email.")
                    }
                    if let failure = failure {
                        Section {
                            Text(failure).foregroundStyle(.red)
                        }
                    }
                }
            }
            .navigationTitle("What would make this better?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(sent ? "Close" : "Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if unlocked {
                        Button(sending ? "Sending..." : "Send") { send() }
                            .disabled(sent || sending || trimmed.isEmpty)
                    } else {
                        Button("Continue") { checkGate() }
                            .disabled(gateAnswer.isEmpty)
                    }
                }
            }
            .onAppear { focused = true }
        }
    }

    private func checkGate() {
        if Feedback.gatePasses(gate.0, gate.1, gateAnswer) {
            unlocked = true
            focused = true
        } else {
            gate = Feedback.gateNumbers()
            gateAnswer = ""
            gateWrong = true
        }
    }

    private func send() {
        let note = trimmed
        sending = true
        failure = nil
        Task { @MainActor in
            do {
                try await Feedback.send(note)
                sent = true
            } catch {
                failure = "Couldn't send it. Check your connection and try again."
            }
            sending = false
        }
    }
}
