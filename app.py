import base64
import os
import sys

import requests
from flask import Flask, jsonify, render_template, request


def _resource_path(relative_path: str) -> str:
    base_path = getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base_path, relative_path)


app = Flask(
    __name__,
    template_folder=_resource_path("templates"),
    static_folder=_resource_path("static"),
)


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/img2img", methods=["POST"])
def img2img():
    data = request.get_json(force=True)

    model = (data.get("model") or "stability/sdxl-img2img").strip()
    custom_model_id = (data.get("custom_model_id") or "").strip()
    api_key = _normalize_api_key(data.get("api_key") or "")
    prompt = (data.get("prompt") or "").strip()
    negative_prompt = (data.get("negative_prompt") or "").strip()
    image_data = data.get("image")

    if not api_key:
        return jsonify({"error": "API key is required."}), 400
    if not prompt:
        return jsonify({"error": "Prompt is required."}), 400
    if not image_data:
        return jsonify({"error": "Please upload a reference image first."}), 400
    if model.startswith("xai/") and api_key.startswith("sk-"):
        return jsonify({"error": "The selected model uses xAI. Please enter an xAI API key instead of an OpenAI key."}), 400
    if model.startswith("openai/") and api_key.startswith("xai-"):
        return jsonify({"error": "The selected model uses OpenAI. Please enter an OpenAI API key instead of an xAI key."}), 400

    try:
        raw_image = _decode_data_url(image_data)

        if model == "stability/sdxl-img2img":
            result_data_url = _call_stability_img2img(
                api_key=api_key,
                prompt=prompt,
                negative_prompt=negative_prompt,
                raw_image=raw_image,
            )
        elif model.startswith("openai/"):
            upstream_model = custom_model_id or model.split("/", 1)[1]
            result_data_url = _call_openai_compatible_img2img(
                base_url="https://api.openai.com/v1",
                upstream_model=upstream_model,
                api_key=api_key,
                prompt=prompt,
                image_data_url=image_data,
                raw_image=raw_image,
            )
        elif model.startswith("xai/"):
            upstream_model = custom_model_id or model.split("/", 1)[1]
            result_data_url = _call_openai_compatible_img2img(
                base_url="https://api.x.ai/v1",
                upstream_model=upstream_model,
                api_key=api_key,
                prompt=prompt,
                image_data_url=image_data,
                raw_image=raw_image,
            )
        else:
            return jsonify({"error": f"Unsupported model: {model}"}), 400

        return jsonify({"image": result_data_url, "model": model})
    except requests.Timeout:
        return jsonify({"error": "The request timed out. Please try again later."}), 504
    except requests.ConnectionError:
        return jsonify({"error": "Network connection failed. Please check your network and try again."}), 503
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500


def _call_stability_img2img(api_key: str, prompt: str, negative_prompt: str, raw_image: bytes) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "application/json",
    }

    files = {
        "init_image": ("input.png", raw_image, "image/png"),
    }

    form = {
        "image_strength": "0.35",
        "cfg_scale": "7",
        "steps": "30",
        "samples": "1",
        "text_prompts[0][text]": _utf8_field(prompt),
        "text_prompts[0][weight]": "1",
    }

    if negative_prompt:
        form["text_prompts[1][text]"] = _utf8_field(negative_prompt)
        form["text_prompts[1][weight]"] = "-1"

    response = requests.post(
        "https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image",
        headers=headers,
        files=files,
        data=form,
        timeout=120,
    )

    if response.status_code != 200:
        _raise_api_error(response)

    payload = response.json()
    image_b64 = payload["artifacts"][0]["base64"]
    return f"data:image/png;base64,{image_b64}"


def _call_openai_compatible_img2img(
    base_url: str,
    upstream_model: str,
    api_key: str,
    prompt: str,
    image_data_url: str,
    raw_image: bytes,
) -> str:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    json_payload = {
        "model": upstream_model,
        "prompt": prompt,
        "response_format": "b64_json",
    }

    if "x.ai" in base_url:
        json_payload["image"] = {"url": image_data_url}
    else:
        json_payload["image"] = image_data_url
        json_payload["size"] = "1024x1024"

    response = requests.post(
        f"{base_url}/images/edits",
        headers=headers,
        json=json_payload,
        timeout=120,
    )

    # Some providers still expect multipart form for edits; retry once if required.
    if response.status_code != 200 and "multipart/form-data" in (response.text or ""):
        fallback_headers = {
            "Authorization": f"Bearer {api_key}",
        }
        files = {
            "image": ("input.png", raw_image, "image/png"),
        }
        form = {
            "model": upstream_model,
            "prompt": _utf8_field(prompt),
            "response_format": "b64_json",
        }
        if "x.ai" not in base_url:
            form["size"] = "1024x1024"
        response = requests.post(
            f"{base_url}/images/edits",
            headers=fallback_headers,
            files=files,
            data=form,
            timeout=120,
        )

    if response.status_code != 200:
        _raise_api_error(response)

    payload = response.json()
    data_item = payload["data"][0]

    if data_item.get("b64_json"):
        return f"data:image/png;base64,{data_item['b64_json']}"

    if data_item.get("url"):
        image_resp = requests.get(data_item["url"], timeout=60)
        mime = image_resp.headers.get("Content-Type", "image/png")
        image_b64 = base64.b64encode(image_resp.content).decode()
        return f"data:{mime};base64,{image_b64}"

    raise RuntimeError("The upstream model did not return a usable image.")


def _decode_data_url(data_url: str) -> bytes:
    if "," in data_url:
        data_url = data_url.split(",", 1)[1]
    return base64.b64decode(data_url)


def _normalize_api_key(api_key: str) -> str:
    """Trim accidental wrapper characters commonly introduced by copy/paste."""
    key = api_key.strip().strip('"').strip("'").strip("`")

    wrapped_pairs = [("(", ")"), ("[", "]"), ("{", "}")]
    for left, right in wrapped_pairs:
        if key.startswith(left) and key.endswith(right) and len(key) > 2:
            key = key[1:-1].strip()
            break

    return key


def _utf8_field(text: str) -> bytes:
    """Encode multipart text fields as UTF-8 bytes to avoid latin-1 errors."""
    return text.encode("utf-8")


def _raise_api_error(response):
    try:
        body = response.json()
        msg = body.get("error", {}).get("message") or body.get("message") or str(body)
    except Exception:
        msg = response.text or f"HTTP {response.status_code}"
    raise RuntimeError(f"Upstream API error: {msg}")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
