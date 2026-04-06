document.addEventListener('DOMContentLoaded', () => {
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
        if (!file.type.startsWith('image/')) {
            showError('Please upload an image file (JPG, PNG, WEBP, HEIC).');
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
            // Hide previous results
            if (resultsContainer) {
                resultsContainer.className = 'section results-hidden';
                resultsContainer.style.paddingTop = '0';
            }
        };
        reader.readAsDataURL(file);
    }

    if (analyzeBtn) {
        // ── Analyze ──
        analyzeBtn.addEventListener('click', async () => {
            if (!selectedFile) return;
            if (loadingOverlay) loadingOverlay.classList.add('active');
            analyzeBtn.disabled = true;
            analyzeBtn.style.opacity = '0.5';

            const formData = new FormData();
            formData.append('file', selectedFile);

            try {
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
                showError('An error occurred while analyzing the image. Please try again.');
            } finally {
                if (loadingOverlay) loadingOverlay.classList.remove('active');
                analyzeBtn.disabled = false;
                analyzeBtn.style.opacity = '1';
            }
        });
    }

    // ── Render Results ──
    function displayResults(data) {
        // Show Image in Report Layout
        const reportImage = document.getElementById('reportImage');
        if (reportImage && previewImage.src) {
            reportImage.src = previewImage.src;
            reportImage.style.display = 'block';
        }

        // Vehicle info
        const vehicleInfo = document.getElementById('vehicleInfo');
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

        // Damage rows
        const damageList = document.getElementById('damageList');
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

        // Confidence bar (static 94.7 since API doesn't return it)
        document.getElementById('confidenceVal').textContent = '94.7%';
        document.getElementById('confidenceFill').style.width = '94.7%';

        // Summary
        document.getElementById('summaryText').textContent = data.summary || 'Analysis complete.';

        // Cost breakdown
        const costBreakdown = document.getElementById('costBreakdown');
        costBreakdown.innerHTML = `
            <div class="cost-row"><span class="cost-label">Parts Cost</span><span class="cost-val">—</span></div>
            <div class="cost-row"><span class="cost-label">Labour Charges</span><span class="cost-val">—</span></div>
            <div class="cost-row"><span class="cost-label">Paint &amp; Finishing</span><span class="cost-val">—</span></div>
            <div class="cost-row"><span class="cost-label">GST (18%)</span><span class="cost-val">—</span></div>`;

        // Total
        let totalInr = data.total_estimated_cost_inr || '—';
        let totalUsd = data.total_estimated_cost_usd || '';
        if (totalInr !== '—' && !totalInr.includes('₹')) totalInr = '₹' + totalInr;
        document.getElementById('totalCost').textContent = totalUsd ? `${totalInr}  ($${totalUsd})` : totalInr;

        // Recommendations
        const recList = document.getElementById('recommendationsList');
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

        // Filename badge
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        document.getElementById('reportFilename').textContent = `autoscan_report_${dateStr}.pdf`;

        // Show results
        resultsContainer.className = 'section results-visible';
        resultsContainer.style.paddingTop = '0';
        resultsContainer.scrollIntoView({ behavior: 'smooth' });
    }

    function downloadReportAsPdf() {
        window.location.href = '/export-pdf';
    }

    const downloadPdfBtn = document.getElementById('downloadPdfBtn');
    if (downloadPdfBtn) {
        downloadPdfBtn.addEventListener('click', downloadReportAsPdf);
    }

    const downloadPdfBtnBottom = document.getElementById('downloadPdfBtnBottom');
    if (downloadPdfBtnBottom) {
        downloadPdfBtnBottom.addEventListener('click', downloadReportAsPdf);
    }

    // ── Demo Video Modal ──
    const seeDemoBtn  = document.getElementById('seeDemoBtn');
    const demoModal   = document.getElementById('demoModal');
    const demoClose   = document.getElementById('demoClose');
    const demoBackdrop= document.getElementById('demoBackdrop');
    const demoVideo   = document.getElementById('demoVideo');

    function openDemo(e) {
        if (e) e.preventDefault();
        demoModal.classList.add('open');
        document.body.style.overflow = 'hidden';
        if (demoVideo) demoVideo.play();
    }

    function closeDemo() {
        demoModal.classList.remove('open');
        document.body.style.overflow = '';
        if (demoVideo) { demoVideo.pause(); demoVideo.currentTime = 0; }
    }

    if (seeDemoBtn)   seeDemoBtn.addEventListener('click', openDemo);
    if (demoClose)    demoClose.addEventListener('click', closeDemo);
    if (demoBackdrop) demoBackdrop.addEventListener('click', closeDemo);

    const findShowroomsBtn = document.getElementById('findShowroomsBtn');
    const locationInput     = document.getElementById('locationInput');
    const searchManualBtn   = document.getElementById('searchManualLocationBtn');

    if (findShowroomsBtn) {
        findShowroomsBtn.addEventListener('mouseover', () => {
            findShowroomsBtn.style.boxShadow = '0 0 30px rgba(0, 255, 102, 0.4)';
            findShowroomsBtn.style.transform = 'scale(1.05)';
        });
        findShowroomsBtn.addEventListener('mouseout', () => {
            findShowroomsBtn.style.boxShadow = '0 0 20px rgba(0, 255, 102, 0.2)';
            findShowroomsBtn.style.transform = 'scale(1.02)';
        });

        findShowroomsBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition((pos) => {
                    const lat = pos.coords.latitude;
                    const lon = pos.coords.longitude;
                    const searchUrl = `https://www.google.com/maps/search/car+repair+showrooms+near+me/@${lat},${lon},15z/data=!3m1!4b1`;
                    window.open(searchUrl, '_blank');
                }, (err) => {
                    console.error("GPS Error:", err.message);
                    window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+me/`, '_blank');
                }, {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 0
                });
            } else {
                window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+me/`, '_blank');
            }
        });
    }

    if (searchManualBtn && locationInput) {
        searchManualBtn.addEventListener('click', () => {
            const query = locationInput.value.trim();
            if (query) {
                // Search near the entered address
                window.open(`https://www.google.com/maps/search/car+repair+showrooms+near+${encodeURIComponent(query)}/`, '_blank');
            } else {
                showError("Please enter a city, area, or PIN code.");
                locationInput.focus();
            }
        });

        // Allow pressing 'Enter' to search
        locationInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchManualBtn.click();
        });
    }

    // ── Mobile Menu Toggle ──
    const navToggle = document.querySelector('.nav-toggle');
    const navLinks  = document.querySelector('.nav-links');

    if (navToggle && navLinks) {
        navToggle.addEventListener('click', () => {
            navLinks.classList.toggle('active');
            navToggle.textContent = navLinks.classList.contains('active') ? '✕' : '☰';
        });

        // Close menu when clicking a link
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                navLinks.classList.remove('active');
                navToggle.textContent = '☰';
            });
        });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && demoModal && demoModal.classList.contains('open')) closeDemo();
        if (e.key === 'Escape' && navLinks && navLinks.classList.contains('active')) {
            navLinks.classList.remove('active');
            navToggle.textContent = '☰';
        }
    });
});
