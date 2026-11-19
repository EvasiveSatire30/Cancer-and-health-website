const navToggle = document.querySelector('.nav-toggle');
const navigation = document.querySelector('.site-nav');

if (navToggle && navigation) {
    navToggle.addEventListener('click', () => {
        const isExpanded = navToggle.getAttribute('aria-expanded') === 'true';
        navToggle.setAttribute('aria-expanded', String(!isExpanded));
        navToggle.setAttribute('aria-label', isExpanded ? 'Open navigation' : 'Close navigation');
        navigation.classList.toggle('is-open', !isExpanded);
    });

    navigation.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navigation.classList.remove('is-open');
            navToggle.setAttribute('aria-expanded', 'false');
            navToggle.setAttribute('aria-label', 'Open navigation');
        });
    });
}

const shareButton = document.querySelector('#shareArticle');
const shareStatus = document.querySelector('#shareStatus');
const shareUrlInput = document.querySelector('#articleShareUrl');

function showCopyableArticleUrl(message) {
    if (!shareUrlInput || !shareStatus) return;
    shareUrlInput.value = window.location.href;
    shareUrlInput.hidden = false;
    shareUrlInput.focus();
    shareUrlInput.select();
    shareStatus.textContent = message;
}

if (shareButton && shareStatus) {
    shareButton.addEventListener('click', async () => {
        const shareData = {
            title: shareButton.dataset.shareTitle,
            text: shareButton.dataset.shareTitle,
            url: window.location.href
        };

        if (navigator.share) {
            try {
                await navigator.share(shareData);
                shareStatus.textContent = 'Share options opened.';
            } catch (error) {
                if (error.name === 'AbortError') {
                    shareStatus.textContent = 'Sharing cancelled.';
                } else {
                    showCopyableArticleUrl('Sharing is unavailable. Copy the article link below.');
                }
            }
            return;
        }

        if (navigator.clipboard && window.isSecureContext) {
            try {
                await navigator.clipboard.writeText(shareData.url);
                shareStatus.textContent = 'Article link copied.';
            } catch {
                showCopyableArticleUrl('Could not copy automatically. Copy the article link below.');
            }
            return;
        }

        showCopyableArticleUrl('Copy the article link below.');
    });
}
