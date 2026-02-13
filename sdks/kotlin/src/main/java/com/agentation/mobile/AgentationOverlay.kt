package com.agentation.mobile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import kotlinx.coroutines.launch

private val StatusColors = mapOf(
    AnnotationStatus.PENDING to Color(0xFFEAB308),
    AnnotationStatus.ACKNOWLEDGED to Color(0xFF3B82F6),
    AnnotationStatus.RESOLVED to Color(0xFF22C55E),
    AnnotationStatus.DISMISSED to Color(0xFF9CA3AF),
)

@Composable
fun AgentationOverlay(
    provider: AgentationProvider,
    content: @Composable () -> Unit,
) {
    val annotations by provider.annotations.collectAsState()
    val connected by provider.connected.collectAsState()
    var showForm by remember { mutableStateOf(false) }
    var formX by remember { mutableDoubleStateOf(0.0) }
    var formY by remember { mutableDoubleStateOf(0.0) }

    val configuration = LocalConfiguration.current
    val screenWidthPx = with(LocalDensity.current) { configuration.screenWidthDp.dp.toPx() }
    val screenHeightPx = with(LocalDensity.current) { configuration.screenHeightDp.dp.toPx() }

    Box(modifier = Modifier.fillMaxSize()) {
        content()

        // Long-press detection layer
        Box(
            modifier = Modifier
                .fillMaxSize()
                .pointerInput(Unit) {
                    detectTapGestures(
                        onLongPress = { offset ->
                            formX = (offset.x / screenWidthPx) * 100
                            formY = (offset.y / screenHeightPx) * 100
                            showForm = true
                        }
                    )
                }
        )

        // Annotation pins
        annotations.forEachIndexed { index, annotation ->
            val pinX = with(LocalDensity.current) {
                ((annotation.x / 100) * screenWidthPx / density).dp - 12.dp
            }
            val pinY = with(LocalDensity.current) {
                ((annotation.y / 100) * screenHeightPx / density).dp - 12.dp
            }
            val color = StatusColors[annotation.status] ?: StatusColors[AnnotationStatus.PENDING]!!

            Box(
                modifier = Modifier
                    .offset(x = pinX, y = pinY)
                    .size(24.dp)
                    .shadow(4.dp, CircleShape)
                    .background(color, CircleShape)
                    .border(2.dp, Color.White, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    text = "${index + 1}",
                    color = Color.White,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        // Connection indicator
        Box(
            modifier = Modifier
                .align(Alignment.TopEnd)
                .padding(8.dp)
                .size(8.dp)
                .background(
                    if (connected || provider.localMode) Color(0xFF22C55E) else Color(0xFFEF4444),
                    CircleShape,
                )
        )
    }

    // Form dialog
    if (showForm) {
        AnnotationFormDialog(
            x = formX,
            y = formY,
            screenWidth = (screenWidthPx).toInt(),
            screenHeight = (screenHeightPx).toInt(),
            provider = provider,
            onDismiss = { showForm = false },
        )
    }
}

@Composable
private fun AnnotationFormDialog(
    x: Double,
    y: Double,
    screenWidth: Int,
    screenHeight: Int,
    provider: AgentationProvider,
    onDismiss: () -> Unit,
) {
    var comment by remember { mutableStateOf("") }
    var intent by remember { mutableStateOf(AnnotationIntent.CHANGE) }
    var severity by remember { mutableStateOf(AnnotationSeverity.SUGGESTION) }
    var submitting by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Dialog(onDismissRequest = onDismiss) {
        Card(
            shape = RoundedCornerShape(12.dp),
            colors = CardDefaults.cardColors(containerColor = Color(0xFF1F2937)),
        ) {
            Column(modifier = Modifier.padding(20.dp)) {
                Text(
                    text = "New Annotation",
                    color = Color.White,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.SemiBold,
                )
                Text(
                    text = "${"%.1f".format(x)}%, ${"%.1f".format(y)}%",
                    color = Color.Gray,
                    fontSize = 12.sp,
                )
                Spacer(Modifier.height(12.dp))

                OutlinedTextField(
                    value = comment,
                    onValueChange = { comment = it },
                    placeholder = { Text("Describe the issue or feedback...") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedTextColor = Color.White,
                        unfocusedTextColor = Color.White,
                        focusedContainerColor = Color(0xFF374151),
                        unfocusedContainerColor = Color(0xFF374151),
                    ),
                )
                Spacer(Modifier.height(12.dp))

                // Intent selector
                Text("Intent", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AnnotationIntent.entries.forEach { value ->
                        ChipButton(
                            label = value.value.replaceFirstChar { it.uppercase() },
                            selected = intent == value,
                            onClick = { intent = value },
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))

                // Severity selector
                Text("Severity", color = Color.Gray, fontSize = 11.sp, fontWeight = FontWeight.Medium)
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    AnnotationSeverity.entries.forEach { value ->
                        ChipButton(
                            label = value.value.replaceFirstChar { it.uppercase() },
                            selected = severity == value,
                            onClick = { severity = value },
                        )
                    }
                }
                Spacer(Modifier.height(16.dp))

                // Actions
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.End,
                ) {
                    TextButton(onClick = onDismiss) {
                        Text("Cancel", color = Color.Gray)
                    }
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = {
                            val trimmed = comment.trim()
                            if (trimmed.isEmpty() || submitting) return@Button
                            submitting = true
                            scope.launch {
                                provider.createAnnotation(
                                    x = x,
                                    y = y,
                                    comment = trimmed,
                                    intent = intent,
                                    severity = severity,
                                    screenWidth = screenWidth,
                                    screenHeight = screenHeight,
                                )
                                submitting = false
                                onDismiss()
                            }
                        },
                        enabled = comment.trim().isNotEmpty() && !submitting,
                    ) {
                        Text(if (submitting) "Saving..." else "Create")
                    }
                }
            }
        }
    }
}

@Composable
private fun ChipButton(label: String, selected: Boolean, onClick: () -> Unit) {
    val bg = if (selected) Color(0xFF333333) else Color(0xFF0A0A0A)
    val borderColor = if (selected) Color.Gray else Color(0xFF333333)
    val textColor = if (selected) Color.White else Color.Gray

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(8.dp),
        color = bg,
        border = androidx.compose.foundation.BorderStroke(1.dp, borderColor),
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = 12.sp,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
            textAlign = TextAlign.Center,
        )
    }
}
