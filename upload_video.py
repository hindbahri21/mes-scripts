# coté caméra local
import os
import io
import sys
from b2sdk.v2 import InMemoryAccountInfo, B2Api
from dotenv import load_dotenv

# Forcer UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.detach(), encoding='utf-8')

def upload_to_b2(input_path, output_path, filename, timestamp, duration):
    load_dotenv()

    key_id = os.getenv("B2_KEY_ID")
    app_key = os.getenv("B2_APPLICATION_KEY")
    bucket_name = os.getenv("B2_BUCKET_NAME")

    if not all([key_id, app_key, bucket_name]):
        print("❌ Erreur : variables B2 non définies dans le .env.")
        return False

    info = InMemoryAccountInfo()
    b2_api = B2Api(info)

    try:
        b2_api.authorize_account("production", key_id, app_key)
        bucket = b2_api.get_bucket_by_name(bucket_name)

        with open(output_path, "rb") as f:
            bucket.upload_bytes(f.read(), filename)
        print(f"✅ Upload sur backblaze B2 réussi")
        return True
    except Exception as e:
        print(f"❌ Erreur d’upload vers B2 : {e}")
        return False
