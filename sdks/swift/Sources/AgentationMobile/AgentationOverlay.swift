import SwiftUI

// MARK: - Overlay

public struct AgentationOverlay<Content: View>: View {
    @ObservedObject var provider: AgentationProvider
    let content: Content

    @State private var showForm = false
    @State private var formX: Double = 0
    @State private var formY: Double = 0

    public init(provider: AgentationProvider, @ViewBuilder content: () -> Content) {
        self.provider = provider
        self.content = content()
    }

    public var body: some View {
        #if DEBUG
        GeometryReader { geometry in
            ZStack {
                content

                // Long-press gesture layer
                Color.clear
                    .contentShape(Rectangle())
                    .onLongPressGesture(minimumDuration: 0.5) {
                        // No-op: completion handled via simultaneous gesture
                    }
                    .simultaneousGesture(
                        LongPressGesture(minimumDuration: 0.5)
                            .sequenced(before: DragGesture(minimumDistance: 0))
                            .onEnded { value in
                                switch value {
                                case .second(true, let drag):
                                    if let location = drag?.location {
                                        formX = (location.x / geometry.size.width) * 100
                                        formY = (location.y / geometry.size.height) * 100
                                        showForm = true
                                    }
                                default:
                                    break
                                }
                            }
                    )

                // Annotation pins
                ForEach(provider.annotations) { annotation in
                    AnnotationPinView(annotation: annotation)
                        .position(
                            x: (annotation.x / 100) * geometry.size.width,
                            y: (annotation.y / 100) * geometry.size.height
                        )
                }

                // Connection indicator
                VStack {
                    HStack {
                        Spacer()
                        Circle()
                            .fill(provider.connected || provider.localMode ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                            .padding(8)
                    }
                    Spacer()
                }
            }
            .sheet(isPresented: $showForm) {
                AnnotationFormView(
                    x: formX,
                    y: formY,
                    screenWidth: Int(geometry.size.width),
                    screenHeight: Int(geometry.size.height),
                    provider: provider,
                    isPresented: $showForm
                )
            }
        }
        #else
        content
        #endif
    }
}

// MARK: - Pin

struct AnnotationPinView: View {
    let annotation: MobileAnnotation

    private var pinColor: Color {
        switch annotation.status {
        case .pending: return .yellow
        case .acknowledged: return .blue
        case .resolved: return .green
        case .dismissed: return .gray
        }
    }

    private var intentLetter: String {
        String(annotation.intent.rawValue.prefix(1)).uppercased()
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(pinColor)
                .frame(width: 24, height: 24)
                .overlay(
                    Circle()
                        .stroke(Color.white, lineWidth: 2)
                )
                .shadow(color: .black.opacity(0.3), radius: 3, y: 2)

            Text(intentLetter)
                .font(.system(size: 10, weight: .bold))
                .foregroundColor(.white)
        }
    }
}

// MARK: - Form

struct AnnotationFormView: View {
    let x: Double
    let y: Double
    let screenWidth: Int
    let screenHeight: Int
    @ObservedObject var provider: AgentationProvider
    @Binding var isPresented: Bool

    @State private var comment = ""
    @State private var intent: AnnotationIntent = .change
    @State private var severity: AnnotationSeverity = .suggestion
    @State private var submitting = false

    var body: some View {
        NavigationView {
            Form {
                Section {
                    Text("Position: \(String(format: "%.1f", x))%, \(String(format: "%.1f", y))%")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextField("What needs attention here?", text: $comment, axis: .vertical)
                        .lineLimit(3...6)
                }

                Section("Intent") {
                    Picker("Intent", selection: $intent) {
                        ForEach(AnnotationIntent.allCases, id: \.self) { value in
                            Text(value.rawValue.capitalized).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                }

                Section("Severity") {
                    Picker("Severity", selection: $severity) {
                        ForEach(AnnotationSeverity.allCases, id: \.self) { value in
                            Text(value.rawValue.capitalized).tag(value)
                        }
                    }
                    .pickerStyle(.segmented)
                }
            }
            .navigationTitle("New Annotation")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { isPresented = false }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Create") {
                        guard !comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                        submitting = true
                        Task {
                            await provider.createAnnotation(
                                x: x,
                                y: y,
                                comment: comment.trimmingCharacters(in: .whitespacesAndNewlines),
                                intent: intent,
                                severity: severity,
                                screenWidth: screenWidth,
                                screenHeight: screenHeight
                            )
                            submitting = false
                            isPresented = false
                        }
                    }
                    .disabled(comment.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || submitting)
                }
            }
        }
        .presentationDetents([.medium])
    }
}
