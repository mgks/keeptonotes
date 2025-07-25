// src/main.js
class NoteMigratorUI {
  constructor() {
    // --- Configuration Registry for all supported formats ---
    this.formats = {
      keep: {
        displayName: 'Google Keep',
        direction: 'both',
        disabledTo: true,
        fileTypes: '.zip,.html',
        module: new KeepConverter(),
        exportInstructions: `In <a href="https://takeout.google.com/" target="_blank" rel="noopener noreferrer">Google Takeout</a>, click "Deselect all," then select only <strong>Keep</strong>. Export as a .zip file.`,
        importInstructions: `Google Keep does not support importing notes. This option is for creating a backup in Keep's native format.`,
      },
      apple: {
        displayName: 'Apple Notes',
        direction: 'to',
        module: new EnexConverter(),
        importInstructions: `On a Mac, open the Notes app, go to <strong>File > Import to Notes...</strong> and select the downloaded <code>.enex</code> file. On iPhone/iPad, save the file to your device, open it via the Files app, tap the Share icon, and choose Notes.`,
      },
      enex: {
        displayName: 'Evernote (.enex)',
        direction: 'both',
        fileTypes: '.enex',
        module: new EnexConverter(),
        exportInstructions: `In the Evernote desktop app, right-click a notebook and choose "Export...". Ensure the format is set to <strong>ENEX (.enex)</strong>.`,
        importInstructions: `In the Evernote desktop app, go to <strong>File > Import...</strong> and select the generated <code>.enex</code> file.`,
      },
      markdown: {
        displayName: 'Markdown / Notion',
        direction: 'both',
        fileTypes: '.zip,.md',
        module: new MarkdownConverter(),
        exportInstructions: `From Notion, open a page and select "Export" from the top-right menu. Choose <strong>Markdown & CSV</strong> format. For best results, include subpages and create folders for them.`,
        importInstructions: `Notion can import the generated <code>.zip</code> file directly. Go to <strong>Settings & Members > Settings > Import data</strong> and choose "HTML".`,
      },
      onenote: {
        displayName: 'Microsoft OneNote',
        direction: 'both',
        disabled: true,
        exportInstructions: `OneNote does not support modern file exports. API-based migration is planned for a future version.`,
      },
    };

    // --- DOM Element Caching ---
    this.cacheDOMElements();
    
    // --- State Management ---
    this.allFiles = [];
    this.selectedFiles = new Set();
    this.zip = null;

    // --- Initialization ---
    this.initCustomSelects();
    this.setupEventListeners();
    this.loadThemePreference();
    this.updateUIForSelection();
  }
  
  // Centralized DOM element caching to prevent "null is not an object" errors on startup.
  cacheDOMElements() {
    this.fromSelect = document.getElementById('convertFrom');
    this.toSelect = document.getElementById('convertTo');
    this.dropZone = document.getElementById('dropZone');
    this.fileInput = document.getElementById('fileInput');
    this.fileListArea = document.getElementById('file-list-area');
    this.fileList = document.getElementById('fileList');
    this.convertButton = document.getElementById('convertButton');
    this.clearButton = document.getElementById('clearButton');
    this.logsButton = document.getElementById('logsButton');
    this.selectAllButton = document.getElementById('selectAllButton');
    this.deselectAllButton = document.getElementById('deselectAllButton');
    this.instructions = document.getElementById('instructions');
    this.darkModeToggle = document.getElementById('darkModeToggle');
    this.logsContainer = document.getElementById('logsContainer');
    this.logs = document.getElementById('logs');
  }
  
  initCustomSelects() {
    this.fromSelect.dataset.value = 'keep';
    this.toSelect.dataset.value = 'apple';

    this.populateSelect(this.fromSelect, 'from');
    this.populateSelect(this.toSelect, 'to');
  }

  populateSelect(selectElement, direction) {
    const dropdown = selectElement.querySelector('.select-dropdown');
    dropdown.innerHTML = '';
    
    for (const [key, format] of Object.entries(this.formats)) {
      if (format.direction === direction || format.direction === 'both') {
        const option = document.createElement('div');
        option.className = 'option';
        option.dataset.value = key;
        option.textContent = format.displayName;
        let isDisabled = format.disabled || (direction === 'to' && format.disabledTo);
        if (isDisabled) {
          option.classList.add('disabled');
        }
        dropdown.appendChild(option);
      }
    }
  }

  setupEventListeners() {
    // Custom select dropdown logic
    document.querySelectorAll('.custom-select').forEach(select => {
      const button = select.querySelector('.select-button');
      const dropdown = select.querySelector('.select-dropdown');
      
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.custom-select').forEach(other => {
            if (other !== select) other.classList.remove('open');
        });
        select.classList.toggle('open');
      });

      dropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('option') && !e.target.classList.contains('disabled')) {
          const isFromSelector = select.id === 'convertFrom';
          const oldValue = select.dataset.value;
          const newValue = e.target.dataset.value;

          if (oldValue !== newValue) {
            select.dataset.value = newValue;
            button.querySelector('span').textContent = e.target.textContent;
            // --- START OF GRACEFUL CHANGE FIX ---
            // Only perform a full reset if the "From" format changes.
            this.updateUIForSelection(isFromSelector);
            // --- END OF GRACEFUL CHANGE FIX ---
          }
        }
        select.classList.remove('open');
      });
    });
    document.addEventListener('click', () => {
      document.querySelectorAll('.custom-select').forEach(s => s.classList.remove('open'));
    });
    
    // Theme toggle
    this.darkModeToggle.addEventListener('click', () => {
      const isDarkMode = document.body.classList.toggle('dark-mode');
      this.saveThemePreference(isDarkMode);
    });

    // File input and drag & drop
    this.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); this.dropZone.classList.add('active'); });
    this.dropZone.addEventListener('dragleave', () => { this.dropZone.classList.remove('active'); });
    this.dropZone.addEventListener('drop', (e) => { e.preventDefault(); this.dropZone.classList.remove('active'); this.handleFileDrop(e.dataTransfer.files); });
    this.dropZone.addEventListener('click', () => this.fileInput.click());
    this.fileInput.addEventListener('change', (e) => this.handleFileDrop(e.target.files));
    
    // Main action buttons
    this.convertButton.addEventListener('click', () => this.runConversion());
    this.clearButton.addEventListener('click', () => this.resetState(true));
    
    // File selection and logs
    this.selectAllButton.addEventListener('click', () => this.toggleAllSelection(true));
    this.deselectAllButton.addEventListener('click', () => this.toggleAllSelection(false));
    this.logsButton.addEventListener('click', () => this.logsContainer.classList.toggle('hidden'));
  }

  // --- UI and State Management ---
  
  // FIX: Added `isFromChange` parameter to control reset behavior.
  updateUIForSelection(isFromChange = true) {
    if (isFromChange) {
      this.resetState(true);
    }
    
    this.instructions.classList.remove('error');
    
    const fromKey = this.fromSelect.dataset.value;
    const toKey = this.toSelect.dataset.value;
    
    // If the "To" selector was just changed to match "From", show error.
    if (fromKey === toKey) {
      this.showError("Cannot convert a format to itself. Please select a different 'To' format.");
      this.convertButton.disabled = true; // Explicitly disable here.
      return;
    }

    // If files are already loaded, re-enable the convert button.
    if (this.allFiles.length > 0) {
      this.convertButton.disabled = false;
    }

    const fromFormat = this.formats[fromKey];
    const toFormat = this.formats[toKey];
    
    this.fileInput.accept = fromFormat.fileTypes || '';
    this.instructions.innerHTML = `<p><strong>Export from ${fromFormat.displayName}:</strong> ${fromFormat.exportInstructions}</p>
                                   <p><strong>Import to ${toFormat.displayName}:</strong> ${toFormat.importInstructions}</p>`;
  }

  async handleFileDrop(droppedFiles) {
    const fromFormat = this.formats[this.fromSelect.dataset.value];
    let filesToDisplay = Array.from(droppedFiles);
    this.zip = null;

    const zipFile = filesToDisplay.find(f => f.name.endsWith('.zip'));
    if (zipFile) {
        try {
            this.zip = await JSZip.loadAsync(zipFile);
            const filePattern = fromFormat.fileTypes.split(',').find(ext => !ext.includes('zip'));
            filesToDisplay = [];
            this.zip.forEach((relativePath, zipEntry) => {
                if (!zipEntry.dir && relativePath.toLowerCase().endsWith(filePattern)) {
                    filesToDisplay.push({ name: zipEntry.name });
                }
            });
        } catch(e) { 
            this.showError(`Could not read the ZIP file. It may be corrupt or in an unexpected format. Error: ${e.message}`);
            return;
        }
    }
    
    this.allFiles = filesToDisplay;
    this.displayFileList();
  }

  displayFileList() {
    this.fileList.innerHTML = '';
    this.selectedFiles.clear();

    if (this.allFiles.length === 0) {
      this.showError("No compatible files were found in your selection. Please check the file format and try again.");
      return;
    }

    this.dropZone.classList.add('hidden');
    this.fileListArea.classList.remove('hidden');
    this.clearButton.classList.remove('hidden');
    this.logsButton.classList.remove('hidden');

    this.allFiles.forEach(file => {
        const listItem = document.createElement('li');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `file-${file.name}`;
        checkbox.name = file.name;
        checkbox.checked = true;
        checkbox.addEventListener('change', () => this.updateSelectionState());
        const label = document.createElement('label');
        label.htmlFor = `file-${file.name}`;
        label.textContent = file.name.split('/').pop();
        listItem.appendChild(checkbox);
        listItem.appendChild(label);
        this.fileList.appendChild(listItem);
        this.selectedFiles.add(file.name);
    });

    this.updateSelectionState();
  }

  updateSelectionState() {
    this.selectedFiles.clear();
    const checkboxes = this.fileList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
        if (cb.checked) {
            this.selectedFiles.add(cb.name);
        }
    });
    this.convertButton.disabled = this.selectedFiles.size === 0;
  }
  
  toggleAllSelection(select) {
    const checkboxes = this.fileList.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => cb.checked = select);
    this.updateSelectionState();
  }

  // --- Core Conversion Logic ---
  async runConversion() {
    this.convertButton.disabled = true;
    this.clearButton.disabled = true;
    this.log("Starting conversion...", "info");
    
    const fromKey = this.fromSelect.dataset.value;
    const toKey = this.toSelect.dataset.value;
    const fromFormat = this.formats[fromKey];
    const toModule = this.formats[toKey].module;

    try {
        let filesToParse = [];
        if (this.zip) {
            const filePromises = [];
            this.selectedFiles.forEach(fileName => {
                const zipEntry = this.zip.file(fileName);
                if (zipEntry) {
                    this.log(`Preparing: ${fileName.split('/').pop()}`);
                    const promise = zipEntry.async('blob').then(blob => new File([blob], zipEntry.name));
                    filePromises.push(promise);
                }
            });
            filesToParse = await Promise.all(filePromises);
        } else {
            filesToParse = this.allFiles.filter(f => this.selectedFiles.has(f.name));
        }

        if (filesToParse.length === 0) {
          this.showError("No files were selected for conversion.");
          return;
        }

        this.log(`Parsing ${filesToParse.length} files...`, "info");
        const notes = await fromFormat.module.parse(filesToParse, this.zip);
        
        if (!notes || notes.length === 0) {
          this.showError("Could not extract any valid notes from the selected files.");
          return;
        }

        this.log(`Generating output for ${notes.length} notes...`, "info");
        const output = await toModule.generate(notes);
        this.downloadOutput(output, toKey);
        this.log(`Success! Your file has been downloaded.`, "success");

    } catch (error) {
        this.showError(`A critical error occurred: ${error.message}`);
        this.log(`Error: ${error.message}`, "error");
    } finally {
        this.convertButton.disabled = false;
        this.clearButton.disabled = false;
    }
  }

  // --- Helper Functions ---
  
  resetState(fullReset = false) {
    if (fullReset) {
      this.allFiles = [];
      this.zip = null;
      this.fileInput.value = '';
      this.fileList.innerHTML = '';
      this.fileListArea.classList.add('hidden');
      this.dropZone.classList.remove('hidden');
      this.clearButton.classList.add('hidden');
      this.logsButton.classList.add('hidden');
      this.logsContainer.classList.add('hidden');
      this.logs.innerHTML = '';
    }
    
    this.selectedFiles.clear();
    this.convertButton.disabled = true;
    
    if (fullReset) {
      this.instructions.classList.remove('error');
      const fromKey = this.fromSelect.dataset.value;
      const toKey = this.toSelect.dataset.value;
      this.convertButton.disabled = fromKey === toKey;
    }
  }

  showError(message) {
      this.instructions.innerHTML = `<p>${message}</p>`;
      this.instructions.classList.add('error');
      this.log(message, "error");
  }

  log(message, type = "info") {
      const logEntry = document.createElement('div');
      logEntry.className = `log-entry ${type}`;
      logEntry.textContent = `[${type.toUpperCase()}] ${message}`;
      this.logs.appendChild(logEntry);
      this.logs.scrollTop = this.logs.scrollHeight;
  }

  downloadOutput(output, formatKey) {
    if (!output) {
        this.showError("The converter did not produce a file to download.");
        return;
    }
    const downloadDetails = {
        apple: { filename: 'notes-for-apple.enex', type: 'application/xml' },
        enex: { filename: 'notes.enex', type: 'application/xml' },
        markdown: { filename: 'notes_markdown.zip', type: 'application/zip' },
        keep: { filename: 'notes_keep.zip', type: 'application/zip' },
    };
    const details = downloadDetails[formatKey];
    const blob = output instanceof Blob ? output : new Blob([output], { type: details.type });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = details.filename;
    link.click();
  }

  loadThemePreference() {
    const darkModeSaved = localStorage.getItem('darkMode');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (darkModeSaved === 'true' || (darkModeSaved === null && systemPrefersDark)) {
      document.body.classList.add('dark-mode');
    }
  }

  saveThemePreference(isDarkMode) {
    localStorage.setItem('darkMode', isDarkMode);
  }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
  new NoteMigratorUI();
});