import AVFoundation
import Foundation
import Speech

/// The audio tap runs on a real-time audio thread while the request it feeds
/// is swapped from the main thread, so the hand-over goes through a lock.
final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?

    func set(_ newRequest: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        request = newRequest
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        lock.lock()
        let current = request
        lock.unlock()
        current?.append(buffer)
    }
}

/// Listens to the microphone and reports what was said, using Apple's speech
/// recognition (on the phone itself where the device supports it).
///
/// Each question gets its own recognition task: `reset(turn:)` throws away
/// the transcript so far, so answers to an earlier question never leak into
/// the next one.
@MainActor
final class SpeechListener {
    /// Running transcript for the current turn, and that turn's number.
    var onResult: ((String, Int) -> Void)?
    /// "listening" or "error" (with a reason the page understands).
    var onState: ((String, String?) -> Void)?

    private let engine = AVAudioEngine()
    private let box = RequestBox()
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var running = false
    private var engineStarted = false
    private var turn = 0
    private var generation = 0
    private var emptyEnds = 0
    /// Words the current game expects, to steer the recogniser.
    private var hints: [String] = SpeechListener.numberWords

    private static let numberWords: [String] = [
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
        "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
        "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
        "eighty", "ninety", "hundred",
    ]

    func start(turn: Int, hints: [String]) {
        self.turn = turn
        self.hints = hints.isEmpty ? SpeechListener.numberWords : hints
        guard !running else { return }
        running = true
        SFSpeechRecognizer.requestAuthorization { status in
            Task { @MainActor in
                guard self.running else { return }
                guard status == .authorized else {
                    self.fail("mic_denied")
                    return
                }
                AVAudioApplication.requestRecordPermission(completionHandler: { granted in
                    Task { @MainActor in
                        guard self.running else { return }
                        if granted {
                            self.begin()
                        } else {
                            self.fail("mic_denied")
                        }
                    }
                })
            }
        }
    }

    func reset(turn: Int) {
        self.turn = turn
        if running && engineStarted { newTask() }
    }

    func stop() {
        guard running else { return }
        shutDown()
    }

    private func begin() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true, options: .notifyOthersOnDeactivation)

            let english = Locale.current.identifier.hasPrefix("en")
            let locale = english ? Locale.current : Locale(identifier: "en-GB")
            guard let found = SFSpeechRecognizer(locale: locale) ?? SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
                  found.isAvailable else {
                fail("voice_failed")
                return
            }
            recognizer = found

            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                fail("no_mic")
                return
            }
            input.removeTap(onBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format, block: SpeechListener.tapBlock(box))
            engine.prepare()
            try engine.start()
            engineStarted = true
            emptyEnds = 0
            newTask()
            onState?("listening", nil)
        } catch {
            fail("voice_failed")
        }
    }

    /// Replaces the current recognition task with a fresh one.
    private func newTask() {
        guard running, let recognizer = recognizer else { return }
        generation += 1
        let myGeneration = generation
        let myTurn = turn
        task?.cancel()

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.requiresOnDeviceRecognition = recognizer.supportsOnDeviceRecognition
        request.addsPunctuation = false
        request.contextualStrings = hints
        box.set(request)

        let deliver: @Sendable (String, Bool) -> Void = { text, ended in
            Task { @MainActor in
                // Ignore callbacks from a task that has since been replaced.
                guard self.running, myGeneration == self.generation else { return }
                if !text.isEmpty {
                    self.emptyEnds = 0
                    self.onResult?(text, myTurn)
                }
                if ended { self.taskEnded(heardSomething: !text.isEmpty) }
            }
        }
        task = recognizer.recognitionTask(with: request, resultHandler: SpeechListener.resultHandler(deliver))
    }

    // These two closures are called on background threads, so they are built
    // outside the main actor and touch nothing that belongs to it.
    private nonisolated static func tapBlock(_ box: RequestBox) -> AVAudioNodeTapBlock {
        return { buffer, _ in
            box.append(buffer)
        }
    }

    private nonisolated static func resultHandler(
        _ deliver: @escaping @Sendable (String, Bool) -> Void
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        return { result, error in
            let text = result?.bestTranscription.formattedString ?? ""
            let ended = error != nil || (result?.isFinal ?? false)
            deliver(text, ended)
        }
    }

    /// A task ends on its own after a pause or a time limit. Start another so
    /// a child who takes a while is still heard, but give up if it keeps
    /// failing straight away.
    private func taskEnded(heardSomething: Bool) {
        if !heardSomething { emptyEnds += 1 }
        if emptyEnds > 8 {
            fail("voice_failed")
            return
        }
        let expected = generation
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if self.running, expected == self.generation { self.newTask() }
        }
    }

    private func fail(_ reason: String) {
        shutDown()
        onState?("error", reason)
    }

    private func shutDown() {
        running = false
        generation += 1
        task?.cancel()
        task = nil
        box.set(nil)
        if engineStarted {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            engineStarted = false
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
