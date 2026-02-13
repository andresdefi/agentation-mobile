import { z } from "zod";

export const PlatformSchema = z.enum(["react-native", "flutter", "ios-native", "android-native"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const AnnotationIntentSchema = z.enum(["fix", "change", "question", "approve"]);
export type AnnotationIntent = z.infer<typeof AnnotationIntentSchema>;

export const AnnotationSeveritySchema = z.enum(["blocking", "important", "suggestion"]);
export type AnnotationSeverity = z.infer<typeof AnnotationSeveritySchema>;

export const AnnotationStatusSchema = z.enum(["pending", "acknowledged", "resolved", "dismissed"]);
export type AnnotationStatus = z.infer<typeof AnnotationStatusSchema>;
