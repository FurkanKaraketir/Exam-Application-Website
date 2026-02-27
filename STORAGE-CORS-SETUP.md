# Firebase Storage CORS Setup

The location QR/barcode images in Firebase Storage require CORS to be configured so they can be fetched for PDF generation in the browser.

## Apply CORS configuration

1. **Install Google Cloud CLI** (if not installed): https://cloud.google.com/sdk/docs/install

2. **Authenticate:**
   ```bash
   gcloud auth login
   ```

3. **Apply the CORS config** (replace `rteprojeihl-29cd5` with your Firebase project ID if different):
   ```bash
   gsutil cors set storage-cors.json gs://rteprojeihl-29cd5.appspot.com
   ```

   Or with the newer gcloud command:
   ```bash
   gcloud storage buckets update gs://rteprojeihl-29cd5.appspot.com --cors-file=storage-cors.json
   ```

4. **Verify** (optional):
   ```bash
   gsutil cors get gs://rteprojeihl-29cd5.appspot.com
   ```

After applying, the location QR codes should appear in the generated PDFs.
