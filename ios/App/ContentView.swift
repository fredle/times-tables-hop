import SwiftUI

struct ContentView: View {
    var body: some View {
        ZStack {
            // Same green as the game's page background, behind the safe areas.
            Color(red: 0.07, green: 0.216, blue: 0.165)
                .ignoresSafeArea()
            GameWebView()
        }
    }
}
