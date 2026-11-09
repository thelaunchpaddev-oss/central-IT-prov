document.addEventListener('DOMContentLoaded', () => {
    const togglePassword = document.getElementById('togglePassword');
    const passwordInput = document.getElementById('password');
    const eyeIcon = document.getElementById('eyeIcon');
    const loginForm = document.getElementById('loginForm');
    const submitBtn = document.getElementById('loginSubmitBtn');
    const resultEl = document.getElementById('loginResult');

    if (togglePassword && passwordInput) {
        togglePassword.addEventListener('click', () => {
            const isPassword = passwordInput.type === 'password';
            passwordInput.type = isPassword ? 'text' : 'password';
            
            if (isPassword) {
                eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />`;
            } else {
                eyeIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>`;
            }
        });
    }

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('email').value.trim();
            const password = passwordInput.value;
            
            if (resultEl) resultEl.innerText = '';

            const originalBtnText = submitBtn.innerHTML;

            submitBtn.disabled = true;
            submitBtn.classList.add('btn-loading');
            submitBtn.innerHTML = `<span class="spinner-sm"></span> Authenticating...`;

            try {
                const response = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });

                const data = await response.json().catch(() => null);

                if (response.ok && data) {
                    submitBtn.innerHTML = `<span class="spinner-sm"></span> Loading Dashboard...`;
                    window.location.href = data.redirect || '/dashboard.html';
                } else {
                    const errorMsg = data?.error || `HTTP ${response.status}: Login endpoint error.`;
                    if (resultEl) resultEl.innerText = errorMsg;
                    resetButton();
                }
            } catch (err) {
                console.error('Login error:', err);
                if (resultEl) resultEl.innerText = `Network Error: ${err.message}`;
                resetButton();
            }

            function resetButton() {
                submitBtn.disabled = false;
                submitBtn.classList.remove('btn-loading');
                submitBtn.innerHTML = originalBtnText;
            }
        });
    }
});