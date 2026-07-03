const Toast = {
  container: null,
  init() {
    this.container = document.getElementById('toastContainer');
  },
    show(type, title, message, duration = 5000) {
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.setAttribute('role', 'alert');
        
        const icons = {
            success: '<svg class="toast-icon" viewBox="0 0 24 24" fill="#188038"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>',
            error: '<svg class="toast-icon" viewBox="0 0 24 24" fill="#c5221f"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/></svg>',
            warning: '<svg class="toast-icon" viewBox="0 0 24 24" fill="#f9ab00"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>',
            info: '<svg class="toast-icon" viewBox="0 0 24 24" fill="#00796b"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg>'
        };
        
        toast.innerHTML = `
            ${icons[type] || icons.info}
            <div class="toast-content">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close" onclick="Toast.dismiss(this.parentElement)" aria-label="Dismiss notification">&times;</button>
        `;
        
        this.container.appendChild(toast);
        
        requestAnimationFrame(() => {
            toast.classList.add('show');
        });
        
        this.announce(`${type}: ${title}. ${message}`);
        
        if (duration > 0) {
            setTimeout(() => {
                this.dismiss(toast);
            }, duration);
        }
        
        return toast;
    },
    dismiss(toast) {
        toast.classList.remove('show');
        toast.addEventListener('transitionend', () => toast.remove());
    },
    announce(message) {
        const liveRegion = document.getElementById('live-region');
        liveRegion.textContent = message;
        setTimeout(() => liveRegion.textContent = '', 1000);
    },
    success(title, message) { return this.show('success', title, message); },
    error(title, message) { return this.show('error', title, message); },
    warning(title, message) { return this.show('warning', title, message); },
    info(title, message) { return this.show('info', title, message); }
};
