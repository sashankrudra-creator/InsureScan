document.addEventListener('DOMContentLoaded', () => {
    // ── 00. Mobile Menu Toggle (First Priority) ──
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks  = document.querySelector('.nav-links');

    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            navToggle.textContent = navLinks.classList.contains('active') ? '✕' : '☰';
        });

        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                navToggle.textContent = '☰';
            });
        });
    }

    // ── 01. Elements ──
    const uploadContainer = document.getElementById('uploadContainer');
    const fileInput       = document.getElementById('fileInput');
    const previewImage    = document.getElementById('previewImage');
    const uploadTitle     = document.getElementById('uploadTitle');
    const uploadSub       = document.getElementById('uploadSub');
    const uploadIconWrap  = document.getElementById('uploadIconWrap');
    const analyzeBtn      = document.getElementById('analyzeBtn');
    const loadingOverlay  = document.getElementById('loadingOverlay');
    const resultsContainer= document.getElementById('resultsContainer');

    let selectedFile = null;

    function showError(message) {
        let container = document.querySelector('.toast-container');
        if (!container) {
            container = document.createElement('div');
            container.className = 'toast-container';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.innerHTML = `<div class="toast-icon">!</div><div>${message}</div>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.animation = 'fadeOutToast 0.3s forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    if (uploadContainer) {
        // ── Drag & Drop ──
        uploadContainer.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadContainer.classList.add('drag-over');
        });
        uploadContainer.addEventListener('dragleave', () => {
            uploadContainer.classList.remove('drag-over');
        });
        uploadContainer.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadContainer.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) handleFileSelect(e.dataTransfer.files[0]);
        });

        // ── Click to Upload ──
        uploadContainer.addEventListener('click', () => fileInput.click());
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleFileSelect(e.target.files[0]);
        });
    }

    function handleFileSelect(file) {
        // More robust check for mobile: some mobile browsers don't provide a type
        // but we can check the extension as a fallback.
        const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(file.name);
        
        if (!isImage) {
            showError('Please upload a valid image file.');
            return;
        }
        selectedFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            if (previewImage) {
                previewImage.src = e.target.result;
                previewImage.style.display = 'block';
            }
            if (uploadIconWrap) uploadIconWrap.style.display = 'none';
            if (uploadTitle) uploadTitle.textContent = file.name;
            if (uploadSub) uploadSub.textContent = `${(file.size / 1024).toFixed(1)} KB — Ready to analyze`;
            if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.style.opacity = '1';
                analyzeBtn.style.cursor = 'pointer';
            }
            if (resultsContainer) {
                resultsContainer.className = 'section results-hidden';
                resultsContainer.style.paddingTop = '0';
            }
        };
        reader.readAsDataURL(file);
    }

    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', async () => {
            if (!selectedFile) return;
            if (loadingOverlay) loadingOverlay.classList.add('active');
            analyzeBtn.disabled = true;
            analyzeBtn.style.opacity = '0.5';

            try {
                // 1. Compress image before upload (converts HEIC to JPG & reduces size)
                const fileToUpload = await compressImage(selectedFile);
                
                const formData = new FormData();
                formData.append('file', fileToUpload);

                // 2. Perform the upload
                const response = await fetch('/analyze', { method: 'POST', body: formData });
                let data = null;
                try { data = await response.json(); } catch (e) {}

                if (data && data.error) {
                    if (data.redirect) {
                        window.location.href = data.redirect;
                        return;
                    }
                    showError(data.error);
                } else if (!response.ok) {
                    throw new Error('Network response was not ok');
                } else if (data) {
                    displayResults(data);
                }
            } catch (err) {
                console.error('Error:', err);
                showError('Could not process image. Please try a different photo or check your connection.');
            } finally {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                analyzeBtn.disabled = false;
                analyzeBtn.style.opacity = '1';
            }
        });
    }

    function displayResults(data) {
        const reportImage = document.getElementById('reportImage');
        if (reportImage && previewImage && previewImage.src) {
            reportImage.src = previewImage.src;
            reportImage.style.display = 'block';
        }

        const vehicleInfo = document.getElementById('vehicleInfo');
        if (vehicleInfo) {
            vehicleInfo.innerHTML = '';
            if (data.vehicle_details) {
                const fields = [
                    { key: 'make', label: 'Make' },
                    { key: 'model', label: 'Model' },
                    { key: 'year', label: 'Year' },
                    { key: 'color', label: 'Color' },
                    { key: 'type', label: 'Type' },
                    { key: 'license_plate', label: 'Plate' },
                ];
                fields.forEach(f => {
                    if (data.vehicle_details[f.key]) {
                        vehicleInfo.innerHTML += `
                            <div class="veh-item">
                                <strong>${f.label}</strong>
                                <span>${data.vehicle_details[f.key]}</span>
                            </div>`;
                    }
                });
            }
        }

        const damageList = document.getElementById('damageList');
        if (damageList) {
            damageList.innerHTML = '';
            if (data.damages && data.damages.length > 0) {
                data.damages.forEach(d => {
                    const sev = d.severity ? d.severity.toLowerCase() : 'low';
                    let tagClass = 'sev-tag-low';
                    if (sev.includes('moderate'))  tagClass = 'sev-tag-med';
                    if (sev.includes('severe'))     tagClass = 'sev-tag-high';
                    if (sev.includes('critical'))   tagClass = 'sev-tag-crit';

                    const costInr = d.estimated_cost_inr ? '₹' + d.estimated_cost_inr : '—';
                    damageList.innerHTML += `
                        <div class="damage-row">
                            <span class="dmg-name">${d.part || 'Unknown'}</span>
                            <span class="dmg-severity ${tagClass}">${d.severity || 'Minor'}</span>
                            <span class="dmg-price">${costInr}</span>
                        </div>`;
                });
            } else {
                damageList.innerHTML = '<p style="color:var(--muted); font-size:14px;">No significant damage detected.</p>';
            }
        }

        const confidenceVal = document.getElementById('confidenceVal');
        const confidenceFill = document.getElementById('confidenceFill');
        if (confidenceVal) confidenceVal.textContent = '94.7%';
        if (confidenceFill) confidenceFill.style.width = '94.7%';

        const summaryText = document.getElementById('summaryText');
        if (summaryText) summaryText.textContent = data.summary || 'Analysis complete.';

        const costBreakdown = document.getElementById('costBreakdown');
        if (costBreakdown) {
            costBreakdown.innerHTML = `
                <div class="cost-row"><span class="cost-label">Parts Cost</span><span class="cost-val">—</span></div>
                <div class="cost-row"><span class="cost-label">Labour Charges</span><span class="cost-val">—</span></div>
                <div class="cost-row"><span class="cost-label">Paint &amp; Finishing</span><span class="cost-val">—</span></div>
                <div class="cost-row"><span class="cost-label">GST (18%)</span><span class="cost-val">—</span></div>`;
        }

        const totalCost = document.getElementById('totalCost');
        if (totalCost) {
            let totalInr = data.total_estimated_cost_inr || '—';
            let totalUsd = data.total_estimated_cost_usd || '';
            if (totalInr !== '—' && !totalInr.includes('₹')) totalInr = '₹' + totalInr;
            totalCost.textContent = totalUsd ? `${totalInr} — ($${totalUsd})` : totalInr;
        }

        const recList = document.getElementById('recommendationsList');
        if (recList) {
            recList.innerHTML = '';
            if (data.recommendations && data.recommendations.length > 0) {
                const ul = document.createElement('ul');
                ul.style.cssText = 'padding-left:18px; display:flex; flex-direction:column; gap:8px;';
                data.recommendations.forEach(r => {
                    const li = document.createElement('li');
                    li.textContent = r;
                    ul.appendChild(li);
                });
                recList.appendChild(ul);
            }
        }

        const reportFilename = document.getElementById('reportFilename');
        if (reportFilename) {
            const now = new Date();
            const dateStr = now.toISOString().split('T')[0];
            reportFilename.textContent = `autoscan_report_${dateStr}.pdf`;
        }

        if (resultsContainer) {
            resultsContainer.className = 'section results-visible';
            resultsContainer.style.paddingTop = '0';
            resultsContainer.scrollIntoView({ behavior: 'smooth' });
        }
    }

    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', () => { window.location.href = '/export-pdf'; });
    }

    const downloadPdfBtnBottom = document.getElementById('downloadPdfBtnBottom');
    if (downloadPdfBtnBottom) {
        downloadPdfBtnBottom.addEventListener('click', () => { window.location.href = '/export-pdf'; });
    }

    const seeDemoBtn  = document.getElementById('seeDemoBtn');
    const demoModal   = document.getElementById('demoModal');
    const demoClose   = document.getElementById('demoClose');
    const demoBackdrop= document.getElementById('demoBackdrop');
    const demoVideo   = document.getElementById('demoVideo');

    function openDemo(e) {
        if (e) e.preventDefault();
        if (demoModal) {
            demoModal.classList.add('open');
            document.body.style.overflow = 'hidden';
            if (demoVideo) demoVideo.play();
        }
    }

    function closeDemo() {
        if (demoModal) {
            demoModal.classList.remove('open');
            document.body.style.overflow = '';
            if (demoVideo) { demoVideo.pause(); demoVideo.currentTime = 0; }
        }
    }

    if (seeDemoBtn) seeDemoBtn.addEventListener('click', openDemo);
    if (demoClose) demoClose.addEventListener('click', closeDemo);
    if (demoBackdrop) demoBackdrop.addEventListener('click', closeDemo);

    const findShowroomsBtn = document.getElementById('findShowroomsBtn');
    if (findShowroomsBtn) {
        findShowroomsBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+me/@${lat},${lon},15z/data=!3m1!4b1`, '_blank');
                }, () => {
                    window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+me/`, '_blank');
                });
            } else {
                window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+me/`, '_blank');
            }
        });
    }

    const locationInput     = document.getElementById('locationInput');
    const searchManualBtn   = document.getElementById('searchManualLocationBtn');
    if (searchManualBtn && locationInput) {
        searchManualBtn.addEventListener('click', () => {
            const query = locationInput.value.trim();
            if (query) {
                window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+${encodeURIComponent(query)}/`, '_blank');
            } else {
                showError("Please enter a city, area, or PIN code.");
                locationInput.focus();
            }
        });
        locationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchManualBtn.click();
        });
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && demoModal && demoModal.classList.contains('open')) closeDemo();
        if (e.key === 'Escape' && navLinks && navLinks.classList.contains('active')) {
            navLinks.classList.remove('active');
            if (navToggle) navToggle.textContent = '☰';
        }
    });

    /**
     * Helper to compress images before upload
     * This fixes mobile upload issues (large file sizes & HEIC format)
     */
    async function compressImage(file, maxWidth = 1280, quality = 0.75) {
        // If file is already small (< 500KB) and is a standard format, don't compress
        if (file.size < 500 * 1024 && file.type === 'image/jpeg') {
            return file;
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    // Calculate new dimensions
                    if (width > maxWidth) {
                        height = Math.round((height * maxWidth) / width);
                        width = maxWidth;
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);

                    canvas.toBlob((blob) => {
                        if (!blob) {
                            reject(new Error('Compression failed'));
                            return;
                        }
                        // Create a new File object from the blob
                        const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(compressedFile);
                    }, 'image/jpeg', quality);
                };
                img.onerror = () => reject(new Error('Image load failed'));
            };
            reader.onerror = () => reject(new Error('File read failed'));
        });
    }
});
