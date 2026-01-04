// Sora Video Downloader - Background Script

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'download') {
    handleDownload(message.url, message.filename)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  }
});

async function handleDownload(url, filename) {
  try {
    // Clean up the URL
    let cleanUrl = url;

    // Decode if URL-encoded
    if (cleanUrl.includes('%2F')) {
      try {
        cleanUrl = decodeURIComponent(cleanUrl);
      } catch (e) {}
    }

    // Fix escaped ampersands
    cleanUrl = cleanUrl.replace(/\\u0026/g, '&');
    cleanUrl = cleanUrl.replace(/&amp;/g, '&');

    // Remove watermark indicator from URL
    cleanUrl = cleanUrl.replace(/00000_wm/g, '00000');
    cleanUrl = cleanUrl.replace(/_wm\//g, '/');
    cleanUrl = cleanUrl.replace(/_wm\./g, '.');

    console.log('[Sora DL Background] Downloading:', cleanUrl);

    // Use Chrome's download API
    const downloadId = await new Promise((resolve, reject) => {
      chrome.downloads.download({
        url: cleanUrl,
        filename: filename,
        saveAs: true // Let user choose location
      }, (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (downloadId === undefined) {
          reject(new Error('Download failed to start'));
        } else {
          resolve(downloadId);
        }
      });
    });

    // Wait for download to complete
    await new Promise((resolve, reject) => {
      const listener = (delta) => {
        if (delta.id !== downloadId) return;

        if (delta.state) {
          if (delta.state.current === 'complete') {
            chrome.downloads.onChanged.removeListener(listener);
            resolve();
          } else if (delta.state.current === 'interrupted') {
            chrome.downloads.onChanged.removeListener(listener);
            reject(new Error('Download interrupted'));
          }
        }

        if (delta.error) {
          chrome.downloads.onChanged.removeListener(listener);
          reject(new Error(delta.error.current));
        }
      };

      chrome.downloads.onChanged.addListener(listener);

      // Timeout after 5 minutes
      setTimeout(() => {
        chrome.downloads.onChanged.removeListener(listener);
        reject(new Error('Download timeout'));
      }, 300000);
    });

  } catch (error) {
    console.error('[Sora DL Background] Download error:', error);
    throw error;
  }
}
