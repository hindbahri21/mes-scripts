# coté caméra local
import cv2
import json
import sys

video_path = sys.argv[1]
output_json = sys.argv[2]

cap = cv2.VideoCapture(video_path)
fgbg = cv2.createBackgroundSubtractorMOG2()

motion_timestamps = []
fps = cap.get(cv2.CAP_PROP_FPS)
frame_number = 0

while True:
    ret, frame = cap.read()
    if not ret:
        break

    fgmask = fgbg.apply(frame)
    count = cv2.countNonZero(fgmask)

    # Seuil arbitraire pour détecter un mouvement significatif
    if count > 5000:
        timestamp = int(frame_number / fps)
        motion_timestamps.append({"timestamp": timestamp, "description": "Mouvement détecté"})

    frame_number += 1

cap.release()

# Évite les doublons dans la liste
unique_motion = []
last_time = -1
for m in motion_timestamps:
    if m["timestamp"] != last_time:
        unique_motion.append(m)
        last_time = m["timestamp"]

with open(output_json, 'w') as f:
    json.dump(unique_motion, f)
