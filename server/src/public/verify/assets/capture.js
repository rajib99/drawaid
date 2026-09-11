(function () {
  "use strict";

  var token = window.location.pathname.split("/").filter(Boolean).pop();

  var SIDES = ["front", "back"];
  var sideIndex = 0;
  var captured = { front: null, back: null };
  var stream = null;

  var screens = {
    intro: document.getElementById("screen-intro"),
    camera: document.getElementById("screen-camera"),
    review: document.getElementById("screen-review"),
    uploading: document.getElementById("screen-uploading"),
    done: document.getElementById("screen-done"),
  };
  var progress = [document.getElementById("prog-1"), document.getElementById("prog-2")];
  var video = document.getElementById("video");
  var canvas = document.getElementById("canvas");
  var previewImg = document.getElementById("preview-img");
  var captureLabel = document.getElementById("capture-label");
  var reviewLabel = document.getElementById("review-label");
  var cameraError = document.getElementById("camera-error");
  var fatalError = document.getElementById("fatal-error");
  var fileFallback = document.getElementById("file-fallback");
  var fileInput = document.getElementById("file-input");

  function show(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("hidden", key !== name);
    });
  }

  function updateProgress() {
    progress.forEach(function (el, i) {
      el.classList.toggle("done", i < sideIndex);
    });
  }

  function showFatal(message) {
    fatalError.textContent = message;
    fatalError.classList.remove("hidden");
  }

  function currentSideLabel(side) {
    return side === "front" ? "front" : "back";
  }

  async function startCamera() {
    cameraError.classList.add("hidden");
    captureLabel.textContent = "Photograph the " + currentSideLabel(SIDES[sideIndex]) + " of your ID";
    show("camera");

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fileFallback.classList.remove("hidden");
      video.classList.add("hidden");
      document.getElementById("btn-capture").classList.add("hidden");
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = stream;
      video.classList.remove("hidden");
      document.getElementById("btn-capture").classList.remove("hidden");
      fileFallback.classList.add("hidden");
    } catch (err) {
      cameraError.textContent =
        "Camera access was denied or unavailable. Use the file picker below instead.";
      cameraError.classList.remove("hidden");
      fileFallback.classList.remove("hidden");
      video.classList.add("hidden");
      document.getElementById("btn-capture").classList.add("hidden");
    }
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        t.stop();
      });
      stream = null;
    }
  }

  function capturePhotoFromVideo() {
    var w = video.videoWidth || 1280;
    var h = video.videoHeight || 720;
    canvas.width = w;
    canvas.height = h;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0, w, h);
    canvas.toBlob(
      function (blob) {
        onPhotoBlob(blob);
      },
      "image/jpeg",
      0.9
    );
  }

  function onPhotoBlob(blob) {
    var side = SIDES[sideIndex];
    captured[side] = blob;
    reviewLabel.textContent = currentSideLabel(side).replace(/^./, function (c) {
      return c.toUpperCase();
    }) + " photo";
    previewImg.src = URL.createObjectURL(blob);
    stopCamera();
    show("review");
  }

  document.getElementById("btn-start").addEventListener("click", startCamera);

  document.getElementById("btn-capture").addEventListener("click", capturePhotoFromVideo);

  fileInput.addEventListener("change", function (e) {
    var file = e.target.files && e.target.files[0];
    if (file) onPhotoBlob(file);
  });

  document.getElementById("btn-retake").addEventListener("click", function () {
    startCamera();
  });

  document.getElementById("btn-use").addEventListener("click", function () {
    sideIndex += 1;
    updateProgress();
    if (sideIndex < SIDES.length) {
      startCamera();
    } else {
      uploadPhotos();
    }
  });

  async function uploadPhotos() {
    show("uploading");
    var form = new FormData();
    form.append("front", captured.front, "front.jpg");
    form.append("back", captured.back, "back.jpg");

    try {
      var res = await fetch("/public/verifications/" + encodeURIComponent(token) + "/upload", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        var body = await res.json().catch(function () {
          return {};
        });
        throw new Error(body.error || "Upload failed (" + res.status + ")");
      }
      show("done");
    } catch (err) {
      show("intro");
      showFatal(err.message || "Something went wrong uploading your ID. Please try again.");
    }
  }

  updateProgress();
})();
