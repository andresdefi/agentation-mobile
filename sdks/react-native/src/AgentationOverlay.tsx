import type {
	AnnotationIntent,
	AnnotationSeverity,
	AnnotationStatus,
} from "@agentation-mobile/core";
import type React from "react";
import { useCallback, useState } from "react";
import {
	Alert,
	Dimensions,
	Modal,
	Pressable,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { useAgentation } from "./useAgentation";

export interface AgentationOverlayProps {
	children: React.ReactNode;
}

const STATUS_COLORS: Record<AnnotationStatus, string> = {
	pending: "#EAB308",
	acknowledged: "#3B82F6",
	resolved: "#22C55E",
	dismissed: "#9CA3AF",
};

const INTENT_OPTIONS: AnnotationIntent[] = ["fix", "change", "question", "approve"];
const SEVERITY_OPTIONS: AnnotationSeverity[] = ["blocking", "important", "suggestion"];

const PIN_SIZE = 24;
const LONG_PRESS_DURATION = 500;

interface AnnotationFormState {
	visible: boolean;
	x: number;
	y: number;
	comment: string;
	intent: AnnotationIntent;
	severity: AnnotationSeverity;
}

const INITIAL_FORM_STATE: AnnotationFormState = {
	visible: false,
	x: 0,
	y: 0,
	comment: "",
	intent: "change",
	severity: "suggestion",
};

export function AgentationOverlay({ children }: AgentationOverlayProps) {
	const { annotations, createAnnotation, connected } = useAgentation();
	const [form, setForm] = useState<AnnotationFormState>(INITIAL_FORM_STATE);
	const [submitting, setSubmitting] = useState(false);

	const handleLongPress = useCallback(
		(event: { nativeEvent: { locationX: number; locationY: number } }) => {
			const { width, height } = Dimensions.get("window");
			const xPercent = (event.nativeEvent.locationX / width) * 100;
			const yPercent = (event.nativeEvent.locationY / height) * 100;

			setForm({
				visible: true,
				x: Math.round(xPercent * 100) / 100,
				y: Math.round(yPercent * 100) / 100,
				comment: "",
				intent: "change",
				severity: "suggestion",
			});
		},
		[],
	);

	const handlePinTap = useCallback(
		(annotation: { comment: string; status: string; intent: string; severity: string }) => {
			Alert.alert(`${annotation.intent} (${annotation.severity})`, annotation.comment, [
				{ text: "OK" },
			]);
		},
		[],
	);

	const handleSubmit = useCallback(async () => {
		if (!form.comment.trim() || submitting) return;

		setSubmitting(true);
		try {
			const { width, height } = Dimensions.get("window");
			await createAnnotation({
				sessionId: "",
				x: form.x,
				y: form.y,
				deviceId: "unknown",
				platform: "react-native",
				screenWidth: width,
				screenHeight: height,
				comment: form.comment.trim(),
				intent: form.intent,
				severity: form.severity,
			});
			setForm(INITIAL_FORM_STATE);
		} catch {
			Alert.alert("Error", "Failed to create annotation. Check your connection.");
		} finally {
			setSubmitting(false);
		}
	}, [form, submitting, createAnnotation]);

	const handleCancel = useCallback(() => {
		setForm(INITIAL_FORM_STATE);
	}, []);

	const { width: screenWidth, height: screenHeight } = Dimensions.get("window");

	return (
		<View style={styles.container}>
			{children}

			{/* Overlay layer for pins and long-press gesture */}
			<Pressable
				style={styles.overlay}
				pointerEvents="box-none"
				onLongPress={handleLongPress}
				delayLongPress={LONG_PRESS_DURATION}
			>
				{/* Annotation pins */}
				{annotations.map((annotation) => {
					const pinX = (annotation.x / 100) * screenWidth - PIN_SIZE / 2;
					const pinY = (annotation.y / 100) * screenHeight - PIN_SIZE / 2;
					const color = STATUS_COLORS[annotation.status] ?? STATUS_COLORS.pending;

					return (
						<TouchableOpacity
							key={annotation.id}
							style={[
								styles.pin,
								{
									left: pinX,
									top: pinY,
									backgroundColor: color,
								},
							]}
							onPress={() => handlePinTap(annotation)}
							activeOpacity={0.7}
						>
							<Text style={styles.pinText}>{annotation.intent.charAt(0).toUpperCase()}</Text>
						</TouchableOpacity>
					);
				})}

				{/* Connection indicator */}
				<View style={styles.statusIndicator}>
					<View
						style={[styles.statusDot, { backgroundColor: connected ? "#22C55E" : "#EF4444" }]}
					/>
				</View>
			</Pressable>

			{/* Annotation creation modal */}
			<Modal visible={form.visible} transparent animationType="fade" onRequestClose={handleCancel}>
				<View style={styles.modalBackdrop}>
					<View style={styles.modalContent}>
						<Text style={styles.modalTitle}>New Annotation</Text>
						<Text style={styles.modalCoords}>
							Position: ({form.x.toFixed(1)}%, {form.y.toFixed(1)}%)
						</Text>

						<TextInput
							style={styles.textInput}
							placeholder="What needs attention here?"
							placeholderTextColor="#9CA3AF"
							value={form.comment}
							onChangeText={(text) => setForm((prev) => ({ ...prev, comment: text }))}
							multiline
							numberOfLines={3}
							autoFocus
						/>

						{/* Intent selector */}
						<Text style={styles.sectionLabel}>Intent</Text>
						<View style={styles.optionRow}>
							{INTENT_OPTIONS.map((intent) => (
								<TouchableOpacity
									key={intent}
									style={[styles.optionButton, form.intent === intent && styles.optionButtonActive]}
									onPress={() => setForm((prev) => ({ ...prev, intent }))}
								>
									<Text
										style={[styles.optionText, form.intent === intent && styles.optionTextActive]}
									>
										{intent}
									</Text>
								</TouchableOpacity>
							))}
						</View>

						{/* Severity selector */}
						<Text style={styles.sectionLabel}>Severity</Text>
						<View style={styles.optionRow}>
							{SEVERITY_OPTIONS.map((severity) => (
								<TouchableOpacity
									key={severity}
									style={[
										styles.optionButton,
										form.severity === severity && styles.optionButtonActive,
									]}
									onPress={() => setForm((prev) => ({ ...prev, severity }))}
								>
									<Text
										style={[
											styles.optionText,
											form.severity === severity && styles.optionTextActive,
										]}
									>
										{severity}
									</Text>
								</TouchableOpacity>
							))}
						</View>

						{/* Action buttons */}
						<View style={styles.actionRow}>
							<TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
								<Text style={styles.cancelButtonText}>Cancel</Text>
							</TouchableOpacity>
							<TouchableOpacity
								style={[
									styles.submitButton,
									(!form.comment.trim() || submitting) && styles.submitButtonDisabled,
								]}
								onPress={handleSubmit}
								disabled={!form.comment.trim() || submitting}
							>
								<Text style={styles.submitButtonText}>
									{submitting ? "Saving..." : "Add Annotation"}
								</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</Modal>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	overlay: {
		...StyleSheet.absoluteFillObject,
		zIndex: 9999,
	},
	pin: {
		position: "absolute",
		width: PIN_SIZE,
		height: PIN_SIZE,
		borderRadius: PIN_SIZE / 2,
		alignItems: "center",
		justifyContent: "center",
		borderWidth: 2,
		borderColor: "#FFFFFF",
		shadowColor: "#000000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.3,
		shadowRadius: 3,
		elevation: 5,
	},
	pinText: {
		color: "#FFFFFF",
		fontSize: 10,
		fontWeight: "700",
	},
	statusIndicator: {
		position: "absolute",
		top: 8,
		right: 8,
		padding: 4,
	},
	statusDot: {
		width: 8,
		height: 8,
		borderRadius: 4,
	},
	modalBackdrop: {
		flex: 1,
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		justifyContent: "center",
		alignItems: "center",
		padding: 24,
	},
	modalContent: {
		backgroundColor: "#1F2937",
		borderRadius: 12,
		padding: 20,
		width: "100%",
		maxWidth: 400,
	},
	modalTitle: {
		color: "#FFFFFF",
		fontSize: 18,
		fontWeight: "600",
		marginBottom: 4,
	},
	modalCoords: {
		color: "#9CA3AF",
		fontSize: 12,
		marginBottom: 16,
	},
	textInput: {
		backgroundColor: "#374151",
		borderRadius: 8,
		padding: 12,
		color: "#FFFFFF",
		fontSize: 14,
		minHeight: 80,
		textAlignVertical: "top",
		marginBottom: 16,
	},
	sectionLabel: {
		color: "#D1D5DB",
		fontSize: 12,
		fontWeight: "600",
		marginBottom: 8,
		textTransform: "uppercase",
	},
	optionRow: {
		flexDirection: "row",
		flexWrap: "wrap",
		gap: 8,
		marginBottom: 16,
	},
	optionButton: {
		paddingHorizontal: 12,
		paddingVertical: 6,
		borderRadius: 8,
		backgroundColor: "#374151",
		borderWidth: 1,
		borderColor: "#4B5563",
	},
	optionButtonActive: {
		backgroundColor: "#3B82F6",
		borderColor: "#3B82F6",
	},
	optionText: {
		color: "#9CA3AF",
		fontSize: 13,
		fontWeight: "500",
	},
	optionTextActive: {
		color: "#FFFFFF",
	},
	actionRow: {
		flexDirection: "row",
		justifyContent: "flex-end",
		gap: 12,
		marginTop: 4,
	},
	cancelButton: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 8,
	},
	cancelButtonText: {
		color: "#9CA3AF",
		fontSize: 14,
		fontWeight: "500",
	},
	submitButton: {
		paddingHorizontal: 16,
		paddingVertical: 10,
		borderRadius: 8,
		backgroundColor: "#3B82F6",
	},
	submitButtonDisabled: {
		opacity: 0.5,
	},
	submitButtonText: {
		color: "#FFFFFF",
		fontSize: 14,
		fontWeight: "600",
	},
});
