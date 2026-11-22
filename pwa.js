(() => {
  const installButton = document.getElementById("install-app-btn");
  let installPrompt = null;

  const isStandalone = () =>
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    navigator.standalone === true;

  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const updateInstallButton = () => {
    if (!installButton) return;

    installButton.hidden = isStandalone() || (!installPrompt && !isIOS);
  };

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;

    if (installButton) installButton.hidden = true;
  });

  installButton?.addEventListener("click", async () => {
    if (isStandalone()) {
      installButton.hidden = true;
      return;
    }

    if (installPrompt) {
      installPrompt.prompt();

      const result = await installPrompt.userChoice;

      if (result.outcome === "accepted") {
        installButton.hidden = true;
      }

      installPrompt = null;

      return;
    }

    if (isIOS) {
      alert(
        'Untuk memasang MotoMesh: tekan tombol Share di browser, lalu pilih "Add to Home Screen" / "Tambahkan ke Layar Utama".',
      );
    }
  });

  updateInstallButton();
  window
    .matchMedia("(display-mode: standalone)")
    .addEventListener?.("change", updateInstallButton);

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((error) => {
        console.error("Service Worker registration failed:", error);
      });
    });
  }
})();
