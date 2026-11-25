import SwiftUI

struct ContentView: View {
    /// The page's "For grown-ups" link opens this, behind a parental gate.
    @State private var showingFeedback = false

    var body: some View {
        ZStack {
            // Same green as the game's page background, behind the safe areas.
            Color(red: 0.07, green: 0.216, blue: 0.165)
                .ignoresSafeArea()
            GameWebView(onGrownUps: { showingFeedback = true })
        }
        .sheet(isPresented: $showingFeedback) {
            FeedbackSheet(grownUpsOnly: true)
        }
    }
}
