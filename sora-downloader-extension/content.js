// Sora Video Downloader - Content Script
(function() {
  'use strict';

  // State
  let selectedVideos = new Map(); // Map<element, videoData>
  let actionBar = null;
  let progressOverlay = null;
  let observer = null;

  // Initialize
  function init() {
    console.log('[Sora DL] Initializing...');
    createActionBar();
    createProgressOverlay();
    scanForVideos();
    setupObserver();

    // Also intercept network requests to capture video URLs
    interceptVideoUrls();
  }

  // Create the floating action bar
  function createActionBar() {
    actionBar = document.createElement('div');
    actionBar.className = 'sora-dl-action-bar hidden';
    actionBar.innerHTML = `
      <div class="sora-dl-count">Selected: <span id="sora-dl-selected-count">0</span> videos</div>
      <button class="sora-dl-btn sora-dl-btn-secondary" id="sora-dl-select-all">Select All</button>
      <button class="sora-dl-btn sora-dl-btn-secondary" id="sora-dl-clear">Clear</button>
      <button class="sora-dl-btn" id="sora-dl-download">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Download Selected
      </button>
    `;
    document.body.appendChild(actionBar);

    // Event listeners
    document.getElementById('sora-dl-download').addEventListener('click', downloadSelected);
    document.getElementById('sora-dl-select-all').addEventListener('click', selectAll);
    document.getElementById('sora-dl-clear').addEventListener('click', clearSelection);
  }

  // Create progress overlay
  function createProgressOverlay() {
    progressOverlay = document.createElement('div');
    progressOverlay.className = 'sora-dl-progress-overlay hidden';
    progressOverlay.innerHTML = `
      <div class="sora-dl-progress-modal">
        <div class="sora-dl-progress-title">Downloading Videos...</div>
        <div id="sora-dl-progress-list"></div>
      </div>
    `;
    document.body.appendChild(progressOverlay);
  }

  // Scan page for video elements
  function scanForVideos() {
    // Look for video containers in the profile grid
    const videoContainers = document.querySelectorAll('a[href*="/p/"], div[data-testid*="video"], article');

    videoContainers.forEach(container => {
      if (container.querySelector('.sora-dl-checkbox-container')) return; // Already processed

      // Find video or thumbnail
      const video = container.querySelector('video');
      const thumbnail = container.querySelector('img[src*="thumb"], img[src*="poster"]');
      const link = container.closest('a[href*="/p/"]') || container.querySelector('a[href*="/p/"]');

      if (video || thumbnail || link) {
        addCheckbox(container, { video, thumbnail, link });
      }
    });

    // Also look for video elements directly
    document.querySelectorAll('video').forEach(video => {
      const container = video.closest('div[class]');
      if (container && !container.querySelector('.sora-dl-checkbox-container')) {
        addCheckbox(container, { video });
      }
    });

    console.log('[Sora DL] Scan complete');
  }

  // Add checkbox to a video container
  function addCheckbox(container, data) {
    // Make sure container has position relative/absolute
    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const checkboxContainer = document.createElement('div');
    checkboxContainer.className = 'sora-dl-checkbox-container';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'sora-dl-checkbox';

    const label = document.createElement('span');
    label.className = 'sora-dl-checkbox-label';
    label.textContent = 'Select';

    checkboxContainer.appendChild(checkbox);
    checkboxContainer.appendChild(label);
    container.appendChild(checkboxContainer);

    // Store reference
    container._soraData = data;

    // Handle selection
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      if (checkbox.checked) {
        selectedVideos.set(container, data);
        container.classList.add('sora-dl-selected');
      } else {
        selectedVideos.delete(container);
        container.classList.remove('sora-dl-selected');
      }
      updateActionBar();
    });

    checkboxContainer.addEventListener('click', (e) => {
      if (e.target !== checkbox) {
        e.preventDefault();
        e.stopPropagation();
        checkbox.checked = !checkbox.checked;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Update action bar visibility and count
  function updateActionBar() {
    const count = selectedVideos.size;
    document.getElementById('sora-dl-selected-count').textContent = count;

    if (count > 0) {
      actionBar.classList.remove('hidden');
    } else {
      actionBar.classList.add('hidden');
    }
  }

  // Select all videos
  function selectAll() {
    document.querySelectorAll('.sora-dl-checkbox').forEach(checkbox => {
      if (!checkbox.checked) {
        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Clear selection
  function clearSelection() {
    document.querySelectorAll('.sora-dl-checkbox').forEach(checkbox => {
      if (checkbox.checked) {
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));
      }
    });
  }

  // Extract video URL from various sources
  async function extractVideoUrl(container, data) {
    let videoUrl = null;
    let videoId = null;

    // Method 1: Direct video source
    if (data.video && data.video.src) {
      videoUrl = data.video.src;
    }

    // Method 2: Video source elements
    if (!videoUrl && data.video) {
      const source = data.video.querySelector('source');
      if (source && source.src) {
        videoUrl = source.src;
      }
    }

    // Method 3: From link href, fetch the page
    if (!videoUrl && data.link) {
      const href = data.link.href || data.link.getAttribute('href');
      if (href) {
        videoId = extractVideoId(href);
        if (videoId) {
          videoUrl = await fetchVideoUrl(videoId, href);
        }
      }
    }

    // Method 4: Look for video URL in any data attributes
    if (!videoUrl) {
      const allElements = container.querySelectorAll('*');
      for (const el of allElements) {
        for (const attr of el.attributes) {
          if (attr.value.includes('videos.openai.com') || attr.value.includes('.mp4')) {
            videoUrl = attr.value;
            break;
          }
        }
        if (videoUrl) break;
      }
    }

    // Remove watermark from URL
    if (videoUrl) {
      videoUrl = removeWatermark(videoUrl);
    }

    return { url: videoUrl, id: videoId };
  }

  // Extract video ID from URL
  function extractVideoId(url) {
    // Pattern: /p/s_xxxxx or /g/gen_xxxxx
    const match = url.match(/\/(?:p|g)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Fetch video URL from video page
  async function fetchVideoUrl(videoId, pageUrl) {
    try {
      // Try to get from current page's network requests first
      if (window._soraVideoUrls && window._soraVideoUrls[videoId]) {
        return window._soraVideoUrls[videoId];
      }

      // Fetch the video page
      const response = await fetch(pageUrl, {
        credentials: 'include',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
      });

      const html = await response.text();

      // Look for video URL in the page
      // Pattern 1: videos.openai.com URL
      let match = html.match(/https:\/\/videos\.openai\.com\/[^"'\s]+\.mp4[^"'\s]*/);
      if (match) {
        return decodeURIComponent(match[0].replace(/\\u0026/g, '&'));
      }

      // Pattern 2: Look in JSON data
      const jsonMatch = html.match(/__NEXT_DATA__.*?<\/script>/);
      if (jsonMatch) {
        const jsonStr = jsonMatch[0].replace('__NEXT_DATA__" type="application/json">', '').replace('</script>', '');
        try {
          const data = JSON.parse(jsonStr);
          const urlFromJson = findVideoUrlInObject(data);
          if (urlFromJson) return urlFromJson;
        } catch (e) {}
      }

      // Pattern 3: Any video URL pattern
      match = html.match(/https:\/\/[^"'\s]+\/source\.mp4[^"'\s]*/);
      if (match) {
        return decodeURIComponent(match[0].replace(/\\u0026/g, '&'));
      }

    } catch (error) {
      console.error('[Sora DL] Error fetching video URL:', error);
    }

    return null;
  }

  // Recursively search for video URL in object
  function findVideoUrlInObject(obj, depth = 0) {
    if (depth > 10) return null;
    if (!obj || typeof obj !== 'object') return null;

    for (const key in obj) {
      const value = obj[key];

      if (typeof value === 'string') {
        if (value.includes('videos.openai.com') && value.includes('.mp4')) {
          return value;
        }
        if (value.includes('/source.mp4') || value.includes('/src.mp4')) {
          return value;
        }
      } else if (typeof value === 'object') {
        const result = findVideoUrlInObject(value, depth + 1);
        if (result) return result;
      }
    }

    return null;
  }

  // Remove watermark from URL (replace _wm with nothing)
  function removeWatermark(url) {
    if (!url) return url;

    // Decode URL if needed
    let decodedUrl = url;
    try {
      if (url.includes('%2F')) {
        decodedUrl = decodeURIComponent(url);
      }
    } catch (e) {}

    // Replace 00000_wm with 00000
    decodedUrl = decodedUrl.replace(/00000_wm/g, '00000');
    decodedUrl = decodedUrl.replace(/_wm\//g, '/');
    decodedUrl = decodedUrl.replace(/_wm\./g, '.');

    return decodedUrl;
  }

  // Download selected videos
  async function downloadSelected() {
    if (selectedVideos.size === 0) return;

    const progressList = document.getElementById('sora-dl-progress-list');
    progressList.innerHTML = '';
    progressOverlay.classList.remove('hidden');

    const downloads = [];
    let index = 0;

    for (const [container, data] of selectedVideos) {
      const itemId = `dl-item-${index}`;
      const itemEl = document.createElement('div');
      itemEl.className = 'sora-dl-progress-item';
      itemEl.id = itemId;
      itemEl.innerHTML = `
        <div class="sora-dl-progress-item-status"><div class="sora-dl-spinner"></div></div>
        <div class="sora-dl-progress-item-name">Video ${index + 1} - Extracting URL...</div>
      `;
      progressList.appendChild(itemEl);
      downloads.push({ container, data, itemId, index });
      index++;
    }

    // Process downloads
    for (const dl of downloads) {
      const itemEl = document.getElementById(dl.itemId);
      const statusEl = itemEl.querySelector('.sora-dl-progress-item-status');
      const nameEl = itemEl.querySelector('.sora-dl-progress-item-name');

      try {
        // Extract URL
        const { url, id } = await extractVideoUrl(dl.container, dl.data);

        if (!url) {
          throw new Error('Could not find video URL');
        }

        nameEl.textContent = `Video ${dl.index + 1} - Downloading...`;

        // Send to background script for download
        const filename = `sora_video_${id || dl.index + 1}_${Date.now()}.mp4`;

        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            action: 'download',
            url: url,
            filename: filename
          }, response => {
            if (response && response.success) {
              resolve();
            } else {
              reject(new Error(response?.error || 'Download failed'));
            }
          });
        });

        statusEl.innerHTML = '<span class="sora-dl-check">✓</span>';
        nameEl.textContent = `Video ${dl.index + 1} - Complete!`;

      } catch (error) {
        console.error('[Sora DL] Download error:', error);
        statusEl.innerHTML = '<span class="sora-dl-error">✕</span>';
        nameEl.textContent = `Video ${dl.index + 1} - ${error.message}`;
      }
    }

    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'sora-dl-btn';
    closeBtn.style.marginTop = '20px';
    closeBtn.style.width = '100%';
    closeBtn.textContent = 'Close';
    closeBtn.onclick = () => {
      progressOverlay.classList.add('hidden');
      clearSelection();
    };
    progressList.appendChild(closeBtn);
  }

  // Intercept video URLs from network requests
  function interceptVideoUrls() {
    window._soraVideoUrls = {};

    // Override fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const response = await originalFetch.apply(this, args);

      try {
        const url = args[0]?.url || args[0];
        if (typeof url === 'string' && (url.includes('videos.openai.com') || url.includes('/api/'))) {
          const clone = response.clone();
          const text = await clone.text();

          // Extract video URLs from response
          const matches = text.matchAll(/https:\/\/videos\.openai\.com\/[^"'\s]+\.mp4[^"'\s]*/g);
          for (const match of matches) {
            const videoUrl = match[0];
            const idMatch = videoUrl.match(/assets%2F([^%]+)/);
            if (idMatch) {
              window._soraVideoUrls[idMatch[1]] = videoUrl;
            }
          }
        }
      } catch (e) {}

      return response;
    };

    // Override XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(...args) {
      this.addEventListener('load', function() {
        try {
          if (this.responseText && (this.responseURL.includes('videos.openai.com') || this.responseURL.includes('/api/'))) {
            const matches = this.responseText.matchAll(/https:\/\/videos\.openai\.com\/[^"'\s]+\.mp4[^"'\s]*/g);
            for (const match of matches) {
              const videoUrl = match[0];
              const idMatch = videoUrl.match(/assets%2F([^%]+)/);
              if (idMatch) {
                window._soraVideoUrls[idMatch[1]] = videoUrl;
              }
            }
          }
        } catch (e) {}
      });
      return originalXHROpen.apply(this, args);
    };
  }

  // Setup mutation observer for dynamically loaded content
  function setupObserver() {
    observer = new MutationObserver((mutations) => {
      let shouldRescan = false;

      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && (
              node.querySelector?.('video') ||
              node.querySelector?.('a[href*="/p/"]') ||
              node.matches?.('video') ||
              node.matches?.('a[href*="/p/"]')
            )) {
              shouldRescan = true;
              break;
            }
          }
        }
        if (shouldRescan) break;
      }

      if (shouldRescan) {
        setTimeout(scanForVideos, 500);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Also run after a short delay to catch lazy-loaded content
  setTimeout(scanForVideos, 2000);
  setTimeout(scanForVideos, 5000);

})();
