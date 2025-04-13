// Google Keep to Evernote Converter
class KeepToEvernoteConverter {
    constructor() {
      this.cal = dayjs; // Using dayjs for better date parsing
    }
  
    // Main conversion function
    async convertKeepToEnex(htmlFiles, progressCallback) {
      try {
        // Create the ENEX header
        const currentDate = dayjs().format('YYYYMMDDTHHmmssZ');
        let enexContent = `<?xml version="1.0" encoding="UTF-8"?>
  <!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
  <en-export export-date="${currentDate}" application="Evernote/Web" version="6.x">`;
  
        // Process each HTML file with progress updates
        const totalFiles = htmlFiles.length;
        for (let i = 0; i < totalFiles; i++) {
          try {
            const file = htmlFiles[i];
            progressCallback((i / totalFiles) * 100, `Processing ${file.name} (${i+1}/${totalFiles})`);
            const noteContent = await this.processHtmlFile(file);
            enexContent += noteContent;
          } catch (fileError) {
            console.error(`Error processing file: ${htmlFiles[i].name}`, fileError);
            progressCallback(null, `Error processing ${htmlFiles[i].name}: ${fileError.message}`, 'error');
          }
        }
  
        // Close the ENEX document
        enexContent += '</en-export>';
        progressCallback(100, 'Processing complete!');
        return enexContent;
      } catch (error) {
        console.error("Conversion failed:", error);
        progressCallback(null, `Conversion failed: ${error.message}`, 'error');
        throw error;
      }
    }
  
    async processHtmlFile(file) {
      try {
        // Validate file is HTML
        if (!file.name.endsWith('.html')) {
          throw new Error(`File ${file.name} is not an HTML file`);
        }
  
        const text = await this.readFileAsText(file);
        
        // Basic validation that this is a Google Keep note
        if (!text.includes('Google Keep') && !text.includes('class="content"')) {
          throw new Error(`File ${file.name} does not appear to be a Google Keep note`);
        }
  
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, 'text/html');
  
        // Extract title
        const title = doc.querySelector('title')?.textContent || 'Untitled Note';
  
        // Check if archived
        const isArchived = text.includes('"archived"');
        let tags = isArchived ? '<tag>archived</tag>' : '';
  
        // Extract date with better parsing
        let dateText = '';
        const dateDiv = doc.body?.children?.[1];
        if (dateDiv) {
          dateText = dateDiv.textContent.trim().replace(/<\/div>/, '') || '';
        }
        
        // Parse date with dayjs
        let dt;
        try {
          dt = dayjs(dateText);
          if (!dt.isValid()) {
            // Fallback to more flexible parsing for Google Keep's date formats
            dt = dayjs(new Date(dateText));
            if (!dt.isValid()) {
              dt = dayjs(); // Use current date as fallback
            }
          }
        } catch (dateError) {
          console.warn(`Date parsing failed for "${dateText}"`, dateError);
          dt = dayjs(); // Use current date as fallback
        }
        
        const iso = dt.format('YYYYMMDDTHHmmssZ');
  
        // Extract content
        let content = '';
        const contentDiv = doc.querySelector('.content');
        if (contentDiv) {
          content = contentDiv.innerHTML;
        } else {
          console.warn(`No content div found in ${file.name}`);
        }
  
        // Process lists
        content = this.processLists(content);
  
        // Extract tags from chips
        const chips = doc.querySelector('.chips');
        if (chips) {
          const labelMatches = [...chips.innerHTML.matchAll(/<span class="chip label"><span class="label-name">([^<]*)<\/span>[^<]*<\/span>/g)];
          if (labelMatches.length > 0) {
            tags = labelMatches.map(match => `<tag>${this.escapeXml(match[1])}</tag>`).join('');
            // Remove chip tags from content
            content = content.replace(/<div class="chips">.*?<\/div>/s, '');
          }
        }
  
        // Process attachments and images
        const resources = [];
        const attachments = doc.querySelector('.attachments');
        if (attachments) {
          const result = await this.processAttachments(attachments, file);
          if (result.contentAdditions) {
            content += result.contentAdditions;
          }
          resources.push(...result.resources);
        }
  
        // Clean up HTML
        content = content.replace(/<br>/g, '<br/>');
        content = content.replace(/class="[^"]*"/g, '');
        
        // Build the note XML
        const resourcesXml = resources.join('');
        
        return `
    <note>
      <title>${this.escapeXml(title)}</title>
      <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note style="word-wrap: break-word; -webkit-nbsp-mode: space; -webkit-line-break: after-white-space;">${content}</en-note>]]></content>
      <created>${iso}</created>
      <updated>${iso}</updated>
      ${tags}
      <note-attributes>
        <latitude>0</latitude>
        <longitude>0</longitude>
        <source>google-keep</source>
        <reminder-order>0</reminder-order>
      </note-attributes>
      ${resourcesXml}
    </note>`;
      } catch (error) {
        console.error(`Error processing HTML file ${file.name}:`, error);
        throw new Error(`Failed to process ${file.name}: ${error.message}`);
      }
    }
  
    // Helper functions
    escapeXml(unsafe) {
      if (!unsafe) return '';
      return unsafe.replace(/[<>&'"]/g, c => {
        switch (c) {
          case '<': return '&lt;';
          case '>': return '&gt;';
          case '&': return '&amp;';
          case '\'': return '&apos;';
          case '"': return '&quot;';
        }
      });
    }
  
    async readFileAsText(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = error => reject(new Error(`Failed to read file: ${error.message}`));
        reader.readAsText(file);
      });
    }
  
    processLists(content) {
      // Process checked items
      let result = content.replace(/<li class="listitem checked"><span class="bullet">&#9745;<\/span>.*?<span class="text">(.*?)<\/span>.*?<\/li>/g, 
        '<en-todo checked="true"/>$1<br/>');
      
      // Process unchecked items
      result = result.replace(/<li class="listitem"><span class="bullet">&#9744;<\/span>.*?<span class="text">(.*?)<\/span>.*?<\/li>/g, 
        '<en-todo checked="false"/>$1<br/>');
      
      // Remove closing ul tag if present
      const lastUlIndex = result.lastIndexOf('</ul>');
      if (lastUlIndex !== -1) {
        result = result.substring(0, lastUlIndex) + result.substring(lastUlIndex + 5);
      }
      
      return result;
    }
  
    async processAttachments(attachmentsDiv, file) {
      const contentAdditions = [];
      const resources = [];
      let attachmentNumber = 0;
      
      try {
        // Process embedded base64 images
        const imgBase64Matches = [...attachmentsDiv.innerHTML.matchAll(/<img alt="" src="data:(.*?);(.*?),(.*?)" \/>/g)];
        for (const match of imgBase64Matches) {
          const mimeType = match[1];
          const encoding = match[2];
          const base64Data = match[3];
          
          try {
            const binaryData = atob(base64Data);
            const bytes = new Uint8Array(binaryData.length);
            for (let i = 0; i < binaryData.length; i++) {
              bytes[i] = binaryData.charCodeAt(i);
            }
            
            const hashHex = await this.calculateHash(bytes);
            const imageFormat = mimeType.split('/')[1];
            
            contentAdditions.push(`\n<div><en-media type="${mimeType}" width="1024" hash="${hashHex}" /></div>`);
            resources.push(`<resource><data encoding="${encoding}">${base64Data}</data>
  <mime>${mimeType}</mime><resource-attributes><file-name>IMAGE_FILE_NAME_${attachmentNumber}.${imageFormat}</file-name></resource-attributes></resource>\n`);
            
            attachmentNumber++;
          } catch (error) {
            console.error(`Error processing embedded image in ${file.name}:`, error);
          }
        }
        
        // Process image file references
        const imgFileMatches = [...attachmentsDiv.innerHTML.matchAll(/<img alt="" src="(.*?\.(jpg|png|gif|jpeg))" \/>/gi)];
        if (imgFileMatches.length > 0) {
          console.info(`Found ${imgFileMatches.length} image references in ${file.name}`);
        }
      } catch (error) {
        console.error(`Error processing attachments in ${file.name}:`, error);
      }
      
      return { contentAdditions: contentAdditions.join(''), resources };
    }
  
    async calculateHash(data) {
      try {
        // Using the Web Crypto API for SHA-256 hash
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
      } catch (error) {
        console.error("Hash calculation failed:", error);
        // Fallback to a simple hash in case Web Crypto API fails
        let hash = 0;
        for (let i = 0; i < data.length; i++) {
          hash = ((hash << 5) - hash) + data[i];
          hash |= 0; // Convert to 32bit integer
        }
        return Math.abs(hash).toString(16).padStart(8, '0');
      }
    }
  }
  
  // UI Handler
  class ConverterUI {
    constructor() {
      this.converter = new KeepToEvernoteConverter();
      this.extractedHtmlFiles = null;
      this.filesToProcess = []; // Track files with selection state
      this.enexContent = null; // Store the generated ENEX content
      
      // DOM element references
      this.dropZone = document.getElementById('dropZone');
      this.fileInput = document.getElementById('fileInput');
      this.fileList = document.getElementById('fileList');
      this.selectedFilesTitle = document.getElementById('selectedFilesTitle');
      this.fileSelectionControls = document.getElementById('fileSelectionControls');
      this.selectAllButton = document.getElementById('selectAllButton');
      this.deselectAllButton = document.getElementById('deselectAllButton');
      this.convertButton = document.getElementById('convertButton');
      this.downloadButton = document.getElementById('downloadButton');
      this.toggleLogsButton = document.getElementById('toggleLogsButton');
      this.logsContainer = document.getElementById('logsContainer');
      this.logsDiv = document.getElementById('logs');
      this.infoIcon = document.getElementById('infoIcon');
      this.infoOverlay = document.getElementById('infoOverlay');
      this.closeInfoButton = document.getElementById('closeInfoButton');
      this.infoHowtoElements = document.querySelectorAll('.infohowto'); // Select all info trigger elements
      this.globalProgressContainer = document.getElementById('globalProgressContainer');
      this.globalProgressBarInner = document.getElementById('globalProgressBarInner');
      this.globalProgressText = document.getElementById('globalProgressText');
      
      // Dark mode toggle
      this.darkModeToggle = document.getElementById('darkModeToggle');
      
      // Elements for GA tracking
      this.supportButton = document.querySelector('.support-button');
      this.takeoutLink = document.querySelector('a[href="https://takeout.google.com/"]');
      this.footerDevLink = document.querySelector('.footer a[href="https://github.com/mgks"]');
      this.footerRepoLink = document.querySelector('.footer a[href="https://github.com/mgks/keeptonotes"]');

      // Data storage
      this.allFiles = new Map(); // Store all files extracted from zip/selection
      this.selectedFiles = new Set(); // Store names of files selected for conversion
      this.convertedEnexContent = null; // Store converted content
      this.zipFileName = 'notes'; // Default zip name
      this.logMessages = []; // Store log messages
      
      // Initialize the app
      this.setupEventListeners();
      this.loadThemePreference(); // Load saved theme preference
    }
    
    setupEventListeners() {
      // --- Dark Mode Toggle ---
      if (this.darkModeToggle) {
        this.darkModeToggle.addEventListener('click', () => {
          const isDarkMode = document.body.classList.toggle('dark-mode');
          this.saveThemePreference(isDarkMode);
          
          if (typeof gtag === 'function') {
            gtag('event', 'toggle_theme', { 
              event_category: 'preferences', 
              event_label: isDarkMode ? 'dark' : 'light' 
            });
          }
        });
      }

      // --- Drag and Drop ---
      this.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.add('drag-over');
      });

      this.dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.remove('drag-over');
      });

      this.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.dropZone.classList.remove('drag-over');
        const files = e.dataTransfer.files;
        if (files.length > 0) {
          this.log(`Files dropped: ${Array.from(files).map(f => f.name).join(', ')}`, 'info', true);
          if (typeof gtag === 'function') {
            gtag('event', 'file_drop', { event_category: 'file_interaction', event_label: 'Drop Zone' });
          }
          this.updateFileList(files);
        }
      });

      // --- File Input Click ---
      this.dropZone.addEventListener('click', () => {
          if (typeof gtag === 'function') {
            gtag('event', 'click', { event_category: 'file_interaction', event_label: 'Drop Zone Click' });
          }
          this.fileInput.click(); // Forward click to hidden input
      });

      // --- File Input Change ---
      this.fileInput.addEventListener('change', (e) => {
        const files = e.target.files;
        if (files.length > 0) {
          this.log(`Files selected: ${Array.from(files).map(f => f.name).join(', ')}`, 'info', true);
          if (typeof gtag === 'function') {
            gtag('event', 'file_browse', { event_category: 'file_interaction', event_label: 'Browse Button' });
          }
          this.updateFileList(files);
        }
        // Reset file input to allow selecting the same file again
        this.fileInput.value = '';
      });

      // --- Selection Buttons ---
      this.selectAllButton.addEventListener('click', () => {
        if (typeof gtag === 'function') {
          gtag('event', 'click', { event_category: 'file_interaction', event_label: 'Select All' });
        }
        this.fileList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
          if (!checkbox.checked) {
            checkbox.checked = true;
            this.updateFileSelection(checkbox);
          }
        });
        this.log(`Selected all files (${this.filesToProcess.length} total)`, 'info', true);
      });

      this.deselectAllButton.addEventListener('click', () => {
        if (typeof gtag === 'function') {
          gtag('event', 'click', { event_category: 'file_interaction', event_label: 'Deselect All' });
        }
        this.fileList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
          if (checkbox.checked) {
            checkbox.checked = false;
            this.updateFileSelection(checkbox);
          }
        });
        this.log('Deselected all files', 'info', true);
      });

      // --- Conversion and Download Buttons ---
      this.convertButton.addEventListener('click', () => {
        if (typeof gtag === 'function') {
          gtag('event', 'start_conversion', { event_category: 'conversion', event_label: 'Convert Button Click' });
        }
        this.log('Starting conversion process...', 'info', true);
        this.handleConversion();
      });

      this.downloadButton.addEventListener('click', () => {
        if (typeof gtag === 'function') {
          gtag('event', 'download', { event_category: 'conversion', event_label: 'Download Button Click' });
        }
        this.downloadEnexFile();
      });

      // --- Toggle Logs Button ---
      this.toggleLogsButton.addEventListener('click', () => {
        const isHidden = this.logsContainer.style.display === 'none' || this.logsContainer.style.display === '';
        this.logsContainer.style.display = isHidden ? 'block' : 'none';
        this.toggleLogsButton.textContent = isHidden ? 'Hide Logs' : 'Show Logs';
        
        // Only track, don't add to user-visible logs
        if (typeof gtag === 'function') {
          gtag('event', 'toggle_logs', { event_category: 'engagement', event_label: isHidden ? 'Show' : 'Hide' });
        }
      });

      // --- Info/How-to Overlay ---
      this.infoHowtoElements.forEach(el => {
        el.addEventListener('click', () => {
          if (typeof gtag === 'function') {
            gtag('event', 'show_info', { event_category: 'engagement', event_label: 'Info Overlay Opened' });
          }
          this.infoOverlay.classList.add('visible');
        });
      });

      this.closeInfoButton.addEventListener('click', () => {
          if (typeof gtag === 'function') {
            gtag('event', 'hide_info', { event_category: 'engagement', event_label: 'Info Overlay Closed' });
          }
          this.infoOverlay.classList.remove('visible');
      });

      // Close overlay if clicked outside the content area
      this.infoOverlay.addEventListener('click', (e) => {
        if (e.target === this.infoOverlay) {
            if (typeof gtag === 'function') {
              gtag('event', 'hide_info', { event_category: 'engagement', event_label: 'Info Overlay Closed (Outside Click)' });
            }
            this.infoOverlay.classList.remove('visible');
        }
      });

      // --- GA Events for External/Support Links ---
      if (this.supportButton) {
        this.supportButton.addEventListener('click', () => {
          if (typeof gtag === 'function') {
            gtag('event', 'click', { event_category: 'navigation', event_label: 'Support Button Click' });
          }
        });
      }

      if (this.takeoutLink) {
          this.takeoutLink.addEventListener('click', () => {
              if (typeof gtag === 'function') {
                gtag('event', 'click', { event_category: 'navigation', event_label: 'Google Takeout Link Click' });
              }
          });
      }

      if (this.footerDevLink) {
          this.footerDevLink.addEventListener('click', () => {
              if (typeof gtag === 'function') {
                gtag('event', 'click', { event_category: 'navigation', event_label: 'Footer Developer Link Click' });
              }
          });
      }

      if (this.footerRepoLink) {
          this.footerRepoLink.addEventListener('click', () => {
              if (typeof gtag === 'function') {
                gtag('event', 'click', { event_category: 'navigation', event_label: 'Footer Repo Link Click' });
              }
          });
      }
    }
    
    updateFileList(files) {
      const fileList = document.getElementById('fileList');
      const fileSelectionControls = document.getElementById('fileSelectionControls');
      const selectedFilesTitle = document.getElementById('selectedFilesTitle');
      
      fileList.innerHTML = '';
      this.filesToProcess = [];
      this.extractedHtmlFiles = null;
      this.resetProgress();
      document.getElementById('downloadButton').style.display = 'none';
      
      // Make the logs button visible as soon as files are selected
      document.getElementById('toggleLogsButton').classList.remove('hidden');
      
      // Hide UI elements initially
      fileList.classList.add('hidden');
      fileSelectionControls.classList.add('hidden');
      selectedFilesTitle.classList.add('hidden');
      
      // Extract zip file or handle HTML files
      if (files.length === 1 && (files[0].type === 'application/zip' || files[0].name.endsWith('.zip'))) {
        // Remove duplicate log message since handleZipFile already logs this
        this.handleZipFile(files[0]);
      } else {
        // Filter and validate HTML files
        const htmlFiles = Array.from(files).filter(file => file.name.endsWith('.html'));
        if (htmlFiles.length === 0) {
          this.log('No HTML files found. Please upload Google Keep HTML files or a Google Takeout zip.', 'error', true);
          return;
        }
        
        // Add HTML files to the list
        this.log(`Found ${htmlFiles.length} HTML files`, 'info', true);
        this.displayFileList(htmlFiles.map(file => ({
          name: file.name,
          file: file,
          selected: true
        })));
        
        // Enable convert button
        document.getElementById('convertButton').disabled = false;
      }
    }
    
    async handleZipFile(zipFile) {
      this.log(`Processing ZIP file: ${zipFile.name}`, 'info', true);
      if (typeof gtag === 'function') {
        gtag('event', 'process_zip_start', { event_category: 'file_interaction', event_label: zipFile.name });
      }
      this.showGlobalProgress();
      this.updateGlobalProgress(0, `Opening ${zipFile.name}...`);

      try {
        const zip = await JSZip.loadAsync(zipFile);
        const fileList = document.getElementById('fileList');
        fileList.innerHTML = '<li class="processing">Extracting files from zip...</li>';
        
        const htmlFiles = [];
        const totalFiles = Object.keys(zip.files).length;
        let processedCount = 0;
        
        // Find all HTML files in the zip
        const zipPromises = [];
        
        zip.forEach((relativePath, zipEntry) => {
          if (!zipEntry.dir) {
            const promise = (async () => {
              processedCount++;
              this.updateGlobalProgress(
                (processedCount / totalFiles) * 100,
                `Examining ${processedCount}/${totalFiles} files in zip...`
              );
              
              if (relativePath.endsWith('.html')) {
                htmlFiles.push({ 
                  name: relativePath,
                  displayName: this.getDisplayName(relativePath),
                  zipEntry 
                });
              }
            })();
            zipPromises.push(promise);
          }
        });
        
        await Promise.all(zipPromises);
        
        fileList.innerHTML = '';
        if (htmlFiles.length === 0) {
          this.log('No HTML files found in the zip file. Make sure this is a valid Google Takeout export.', 'error', true);
          if (typeof gtag === 'function') {
            gtag('event', 'no_html_files_found', { event_category: 'file_interaction', event_label: zipFile.name });
          }
          this.hideGlobalProgress();
          return;
        }
        
        this.log(`Found ${htmlFiles.length} HTML files in the zip`, 'info', true);
        
        // Store the extracted files for conversion and display them
        this.extractedHtmlFiles = htmlFiles;
        this.displayFileList(htmlFiles.map(file => ({
          name: file.name,
          displayName: file.displayName,
          zipEntry: file.zipEntry,
          selected: true
        })));
        
        document.getElementById('convertButton').disabled = false;
        this.hideGlobalProgress();
        
      } catch (error) {
        console.error('Error processing zip file:', error);
        this.log(`Error processing ZIP file: ${error.message}`, 'error', true);
        if (typeof gtag === 'function') {
          gtag('event', 'process_zip_error', { event_category: 'file_interaction', event_label: zipFile.name, description: error.message });
        }
        document.getElementById('convertButton').disabled = true;
        this.hideGlobalProgress();
      }
    }
    
    getDisplayName(fullPath) {
      // Remove Takeout/Keep/ prefix and .html extension
      let displayName = fullPath;
      
      // Handle Takeout directory structure
      if (displayName.includes('Takeout/Keep/')) {
        displayName = displayName.split('Takeout/Keep/')[1];
      } else if (displayName.includes('Keep/')) {
        displayName = displayName.split('Keep/')[1];
      }
      
      // Remove .html extension
      if (displayName.endsWith('.html')) {
        displayName = displayName.substring(0, displayName.length - 5);
      }
      
      return displayName;
    }
    
    displayFileList(files) {
      // Only log to console, not to UI
      this.log(`Displaying ${files.length} files`, 'info', false);
      
      const fileList = document.getElementById('fileList');
      const fileSelectionControls = document.getElementById('fileSelectionControls');
      const selectedFilesTitle = document.getElementById('selectedFilesTitle');
      
      // Show UI elements
      fileList.classList.remove('hidden');
      fileSelectionControls.classList.remove('hidden');
      selectedFilesTitle.classList.remove('hidden');
      
      fileList.innerHTML = '';
      this.filesToProcess = files;
      
      files.forEach((fileInfo, index) => {
        const item = document.createElement('li');
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `file-${index}`;
        checkbox.checked = fileInfo.selected;
        checkbox.dataset.index = index;
        checkbox.addEventListener('change', (e) => {
          if (typeof gtag === 'function') {
            gtag('event', 'toggle_file_selection', { 
              event_category: 'file_interaction', 
              event_label: e.target.checked ? 'select' : 'deselect' 
            });
          }
          this.updateFileSelection(e.target);
        });
        
        const label = document.createElement('label');
        label.htmlFor = `file-${index}`;
        label.textContent = fileInfo.displayName || this.getDisplayName(fileInfo.name);
        
        item.appendChild(checkbox);
        item.appendChild(label);
        fileList.appendChild(item);
      });
      
      // Show selection controls
      document.getElementById('fileSelectionControls').style.display = 'flex';
      
      // Add a summary message for the user
      this.log(`Ready to convert ${files.length} notes`, 'info', true);
    }
    
    updateFileSelection(checkbox) {
      const index = parseInt(checkbox.dataset.index);
      if (this.filesToProcess[index]) {
        this.filesToProcess[index].selected = checkbox.checked;
      }
      
      // Update convert button status
      const hasSelectedFiles = this.filesToProcess.some(file => file.selected);
      const selectedCount = this.filesToProcess.filter(file => file.selected).length;
      document.getElementById('convertButton').disabled = !hasSelectedFiles;
      
      // Only log when all are selected or none are selected
      const totalCount = this.filesToProcess.length;
      if (selectedCount === 0) {
        this.log(`No files selected for conversion (out of ${totalCount} available)`, 'warning', true);
      } else if (selectedCount === totalCount && totalCount > 1) {
        // Only log when all files are selected
        this.log(`All ${totalCount} files selected for conversion`, 'info', true);
      }
    }
    
    async handleConversion() {
      const convertButton = document.getElementById('convertButton');
      const downloadButton = document.getElementById('downloadButton');
      
      convertButton.disabled = true;
      downloadButton.style.display = 'none';
      this.showGlobalProgress();
      this.updateGlobalProgress(0, 'Starting conversion...');
      
      // Show toggle logs button
      document.getElementById('toggleLogsButton').classList.remove('hidden');
      
      try {
        let htmlFiles = [];
        const selectedFiles = this.filesToProcess.filter(file => file.selected);
        
        if (selectedFiles.length === 0) {
          this.log('No files selected for conversion', 'error', true);
          if (typeof gtag === 'function') {
            gtag('event', 'conversion_error', { event_category: 'conversion', event_label: 'No files selected' });
          }
          this.hideGlobalProgress();
          convertButton.disabled = false;
          return;
        }
        
        this.log(`Converting ${selectedFiles.length} files...`, 'info', true);
        
        if (this.extractedHtmlFiles) {
          // Process HTML files from the zip
          this.updateGlobalProgress(0, 'Preparing HTML files from zip...');
          const total = selectedFiles.length;
          
          for (let i = 0; i < total; i++) {
            const file = selectedFiles[i];
            this.updateGlobalProgress((i / total) * 20, `Extracting file ${i+1}/${total}...`);
            
            try {
              const content = await file.zipEntry.async('blob');
              const htmlFile = new File([content], file.name, { type: 'text/html' });
              htmlFiles.push(htmlFile);
            } catch (error) {
              this.log(`Failed to extract ${file.name}: ${error.message}`, 'error', true);
            }
          }
          
          this.updateGlobalProgress(20, `Extracted ${htmlFiles.length} HTML files`);
        } else {
          // Process directly uploaded HTML files
          htmlFiles = selectedFiles.map(fileInfo => fileInfo.file);
          this.updateGlobalProgress(20, `Prepared ${htmlFiles.length} HTML files`);
        }
        
        if (htmlFiles.length === 0) {
          this.log('No HTML files found for conversion', 'error', true);
          if (typeof gtag === 'function') {
            gtag('event', 'conversion_error', { event_category: 'conversion', event_label: 'No valid files' });
          }
          this.hideGlobalProgress();
          convertButton.disabled = false;
          return;
        }
        
        // Set up progress callback function
        const progressCallback = (percent, message, type = 'info') => {
          if (percent !== null) {
            // Scale remaining progress from 20-95%
            this.updateGlobalProgress(20 + (percent * 0.75), message);
          }
          if (message) {
            // Always show converter messages in the UI
            this.log(message, type, true);
          }
        };
        
        const enexContent = await this.converter.convertKeepToEnex(htmlFiles, progressCallback);
        this.enexContent = enexContent; // Store for later download
        
        this.updateGlobalProgress(95, 'Creating download...');
        
        // Trigger download
        this.downloadEnexFile();
        
        this.updateGlobalProgress(100, 'Conversion complete!');
        this.log(`Successfully converted ${htmlFiles.length} notes to ENEX format`, 'success', true);
        if (typeof gtag === 'function') {
          gtag('event', 'conversion_success', { 
            event_category: 'conversion', 
            event_label: 'Conversion Complete',
            value: selectedFiles.length
          });
        }
        
        // Show download button for re-downloading
        downloadButton.style.display = 'inline-block';
        
        // Hide progress bar after a delay
        setTimeout(() => {
          this.hideGlobalProgress();
        }, 2000);
        
      } catch (error) {
        console.error('Conversion error:', error);
        this.log(`Conversion error: ${error.message}`, 'error', true);
        if (typeof gtag === 'function') {
          gtag('event', 'conversion_error', { 
            event_category: 'conversion', 
            event_label: 'Conversion Failed',
            description: error.message
          });
        }
        this.hideGlobalProgress();
      } finally {
        convertButton.disabled = false;
      }
    }
    
    downloadEnexFile() {
      if (!this.enexContent) {
        this.log('No converted content available for download', 'error', true);
        if (typeof gtag === 'function') {
          gtag('event', 'download_error', { event_category: 'conversion', event_label: 'No content to download' });
        }
        return;
      }
      
      // Create and download the ENEX file
      const blob = new Blob([this.enexContent], { type: 'application/enex' });
      const downloadLink = document.createElement('a');
      downloadLink.href = URL.createObjectURL(blob);
      downloadLink.download = 'google_keep_notes.enex';
      downloadLink.click();
      
      this.log('ENEX file downloaded successfully. You can now import this file into Apple Notes.', 'success', true);
      if (typeof gtag === 'function') {
        gtag('event', 'download_success', { 
          event_category: 'conversion', 
          event_label: 'Download Completed',
          value: this.filesToProcess.filter(f => f.selected).length
        });
      }
    }
    
    showGlobalProgress() {
      // Only show progress for meaningful operations
      this.globalProgressContainer.classList.add('visible');
    }
    
    hideGlobalProgress() {
      this.globalProgressContainer.classList.remove('visible');
    }
    
    updateGlobalProgress(percent, message) {
      // Make progress messages more user-relevant
      const clampedPercent = Math.max(0, Math.min(100, percent)); // Ensure percent is 0-100
      this.globalProgressBarInner.style.width = `${clampedPercent}%`;
      
      // Only update message if provided and different from previous
      if (message && this.globalProgressText.textContent !== message) {
        this.globalProgressText.textContent = message;
        
        // For important progress updates (25%, 50%, 75%, 100%), log to UI
        if (clampedPercent === 25 || clampedPercent === 50 || 
            clampedPercent === 75 || clampedPercent === 100) {
          this.log(message, 'info', true);
        }
      }
    }
    
    resetProgress() {
      const progressBarInner = document.getElementById('globalProgressBarInner');
      const progressText = document.getElementById('globalProgressText');
      
      progressBarInner.style.width = '0%';
      progressText.textContent = '';
      this.hideGlobalProgress();
    }
    
    log(message, type = 'info', showInUi = true) {
      // Basic console logging always happens
      if (type === 'error') {
        console.error(`[${type.toUpperCase()}] ${message}`);
      } else if (type === 'warning') {
        console.warn(`[${type.toUpperCase()}] ${message}`);
      } else {
        console.log(`[${type.toUpperCase()}] ${message}`);
      }
      
      // Add to log array (optional, if needed for other features)
      this.logMessages.push({ message, type, timestamp: new Date() });
      
      // Only add to visible UI logs if it's user-relevant information
      if (showInUi) {
        // Update logs in UI
        const logsContainer = document.getElementById('logs');
        const logEntry = document.createElement('div');
        logEntry.className = `log-entry ${type}`;
        logEntry.textContent = message;
        logsContainer.appendChild(logEntry);
        
        // Auto-scroll logs to bottom
        logsContainer.scrollTop = logsContainer.scrollHeight;
      }
    }

    // --- Theme Preference Methods ---
    loadThemePreference() {
      // Check for saved preference
      const darkModePreferred = localStorage.getItem('darkMode') === 'true';
      
      // If no stored preference, check system preference
      const systemPrefersDark = window.matchMedia && 
        window.matchMedia('(prefers-color-scheme: dark)').matches;
        
      if (darkModePreferred || (systemPrefersDark && localStorage.getItem('darkMode') === null)) {
        document.body.classList.add('dark-mode');
        
        // Track system preference application
        if (typeof gtag === 'function' && systemPrefersDark && localStorage.getItem('darkMode') === null) {
          gtag('event', 'theme_system_preference', { 
            event_category: 'preferences', 
            event_label: 'dark' 
          });
        }
      }
      
      // Also listen for system changes
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
          if (localStorage.getItem('darkMode') === null) { // Only auto-switch if user hasn't set a preference
            if (e.matches) {
              document.body.classList.add('dark-mode');
            } else {
              document.body.classList.remove('dark-mode');
            }
          }
        });
      }
    }
    
    saveThemePreference(isDarkMode) {
      localStorage.setItem('darkMode', isDarkMode);
    }
  }

  // Initialize the application when the DOM is loaded
  document.addEventListener('DOMContentLoaded', () => {
    new ConverterUI();
  });