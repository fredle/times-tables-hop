import AVFoundation
import Foundation
import Speech

/// The audio tap runs on a real-time audio thread while the request it feeds
/// is swapped from the main thread, so the hand-over goes through a lock.
///
/// It also keeps the last second of microphone audio. Apple's recogniser
/// ends a session by itself after a pause, and anything said while the next
/// one starts would otherwise be lost: a child who says "forty..." and then
/// "forty-two" is often doing exactly that. The kept audio is replayed into
/// the new session so the start of the second try is still heard.
final class RequestBox: @unchecked Sendable {
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recent: [AVAudioPCMBuffer] = []
    private var recentFrames: AVAudioFrameCount = 0

    /// Swaps in a new request. With `replay` the last second of audio is fed
    /// to it first; without it that audio is dropped, so speech from before a
    /// new question never reaches the new question's request.
    func set(_ newRequest: SFSpeechAudioBufferRecognitionRequest?, replay: Bool) {
        lock.lock()
        request = newRequest
        if replay, let newRequest = newRequest {
            for buffer in recent { newRequest.append(buffer) }
        } else {
            recent.removeAll()
            recentFrames = 0
        }
        lock.unlock()
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        let kept = RequestBox.copy(buffer)
        lock.lock()
        let current = request
        if let kept = kept {
            recent.append(kept)
            recentFrames += kept.frameLength
            let limit = AVAudioFrameCount(max(kept.format.sampleRate, 1))
            while recentFrames > limit, recent.count > 1 {
                recentFrames -= recent.removeFirst().frameLength
            }
        }
        current?.append(buffer)
        lock.unlock()
    }

    /// The engine may reuse the buffers it hands to the tap, so keep copies.
    private static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard buffer.frameLength > 0,
              let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
            return nil
        }
        copy.frameLength = buffer.frameLength
        let source = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let target = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for (from, to) in zip(source, target) {
            guard let fromData = from.mData, let toData = to.mData else { continue }
            memcpy(toData, fromData, Int(min(from.mDataByteSize, to.mDataByteSize)))
        }
        return copy
    }
}

/// Listens to the microphone and reports what was said, using Apple's speech
/// recognition (on the phone itself where the device supports it).
///
/// Each question gets its own recognition task: `reset(turn:)` throws away
/// the transcript so far, so answers to an earlier question never leak into
/// the next one. Within a question, text from a session that ended after a
/// pause is carried into the next one.
@MainActor
final class SpeechListener {
    /// Running transcript for the current turn, that turn's number, and the
    /// recogniser's other readings of the same speech.
    var onResult: ((String, Int, [String]) -> Void)?
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
    /// What earlier sessions heard during the current turn.
    private var carried = ""
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
        carried = ""
        if running && engineStarted { newTask(replay: false) }
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
            carried = ""
            newTask(replay: false)
            onState?("listening", nil)
        } catch {
            fail("voice_failed")
        }
    }

    /// Replaces the current recognition task with a fresh one. `replay` feeds
    /// it the last second of audio first (used when a session ended by itself
    /// mid-question, not when a new question starts).
    private func newTask(replay: Bool) {
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

        let deliver: @Sendable (String, [String], Bool) -> Void = { text, others, ended in
            Task { @MainActor in
                // Ignore callbacks from a task that has since been replaced.
                guard self.running, myGeneration == self.generation, myTurn == self.turn else { return }
                let full = self.joined(text)
                if !text.isEmpty {
                    self.emptyEnds = 0
                    self.onResult?(full, myTurn, others.map { self.joined($0) })
                }
                if ended {
                    if !text.isEmpty { self.carried = full }
                    self.taskEnded(heardSomething: !text.isEmpty)
                }
            }
        }
        task = recognizer.recognitionTask(with: request, resultHandler: SpeechListener.resultHandler(deliver))
        box.set(request, replay: replay)
    }

    private func joined(_ text: String) -> String {
        if carried.isEmpty { return text }
        if text.isEmpty { return carried }
        return carried + " " + text
    }

    // These two closures are called on background threads, so they are built
    // outside the main actor and touch nothing that belongs to it.
    private nonisolated static func tapBlock(_ box: RequestBox) -> AVAudioNodeTapBlock {
        return { buffer, _ in
            box.append(buffer)
        }
    }

    private nonisolated static func resultHandler(
        _ deliver: @escaping @Sendable (String, [String], Bool) -> Void
    ) -> (SFSpeechRecognitionResult?, Error?) -> Void {
        return { result, error in
            let text = result?.bestTranscription.formattedString ?? ""
            // The recogniser's other guesses: a repeated or corrected answer
            // is sometimes only in one of these.
            let others = (result?.transcriptions ?? [])
                .map { $0.formattedString }
                .filter { !$0.isEmpty && $0 != text }
            let ended = error != nil || (result?.isFinal ?? false)
            deliver(text, Array(others.prefix(5)), ended)
        }
    }

    /// A task ends on its own after a pause or a time limit. Start another at
    /// once so a child who takes a while is still heard (the kept audio covers
    /// the hand-over), but give up if it keeps failing straight away.
    private func taskEnded(heardSomething: Bool) {
        if !heardSomething { emptyEnds += 1 }
        if emptyEnds > 8 {
            fail("voice_failed")
            return
        }
        if heardSomething {
            newTask(replay: true)
            return
        }
        let expected = generation
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 300_000_000)
            if self.running, expected == self.generation { self.newTask(replay: true) }
        }
    }

    private func fail(_ reason: String) {
        shutDown()
        onState?("error", reason)
    }

    private func shutDown() {
        running = false
        generation += 1
        carried = ""
        task?.cancel()
        task = nil
        box.set(nil, replay: false)
        if engineStarted {
            engine.inputNode.removeTap(onBus: 0)
            engine.stop()
            engineStarted = false
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
