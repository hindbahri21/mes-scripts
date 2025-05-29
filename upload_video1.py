# coté caméra de surveillance
import sys
import io
import sys
import os
from b2sdk.v2 import InMemoryAccountInfo, B2Api
from dotenv import load_dotenv

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def upload_to_b2(file_path):
    load_dotenv()

    key_id = os.getenv("B2_KEY_ID")
    app_key = os.getenv("B2_APPLICATION_KEY")
    bucket_name = os.getenv("B2_BUCKET_NAME")

    if not all([key_id, app_key, bucket_name]):
        print("❌ Variables d'environnement B2 manquantes.")
        return 1

    info = InMemoryAccountInfo()
    b2_api = B2Api(info)

    try:
        b2_api.authorize_account("production", key_id, app_key)
        bucket = b2_api.get_bucket_by_name(bucket_name)

        file_name = os.path.basename(file_path)
        # print(f"⏳ Upload de {file_name} sur Backblaze B2...")

        with open(file_path, "rb") as f:
            bucket.upload_bytes(f.read(), file_name)

        print(f"✅ Upload réussi vers Backblaze B2 : {file_name}", flush=True)
        return 0
    except Exception as e:
        print(f"❌ Erreur d'upload : {e}", flush=True)
        return 2

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage : python upload_video1.py <file_path>")
        sys.exit(1)

    file_path = sys.argv[1]
    exit_code = upload_to_b2(file_path)
    sys.exit(exit_code)
