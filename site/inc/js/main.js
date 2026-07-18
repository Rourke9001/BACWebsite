(function ($) {
    'use strict';

    function normalisePath(url) {
        try {
            var parsed = new URL(url, window.location.origin);
            var path = parsed.pathname.replace(/\/+$/, '');
            return path || '/';
        } catch (error) {
            return url;
        }
    }

    function setActiveNavLink() {
        var currentPath = normalisePath(window.location.href);
        var links = document.querySelectorAll('.glhb-nav-link, .glhb-submenu-link');

        function getDirectMenuLink(container) {
            var i;

            for (i = 0; i < container.children.length; i += 1) {
                if (container.children[i].matches('.glhb-nav-link, .glhb-submenu-link')) {
                    return container.children[i];
                }
            }

            return null;
        }

        function markAncestorLinks(link) {
            var parentContainer = link.parentElement;

            while (parentContainer) {
                parentContainer = parentContainer.parentElement ? parentContainer.parentElement.closest('.glhb-submenu-item, .glhb-submenu-item-mobile, .glhb-nav-item, .glhb-nav-item-mobile') : null;

                if (!parentContainer) {
                    return;
                }

                var parentLink = getDirectMenuLink(parentContainer);
                if (parentLink && parentLink !== link) {
                    parentLink.classList.add('active-ancestor');
                }
            }
        }

        links.forEach(function (link) {
            var href = link.getAttribute('href');

            if (!href) {
                return;
            }

            if (normalisePath(href) === currentPath) {
                link.classList.add('active-page');
                markAncestorLinks(link);
            }
        });
    }

    function initMobileNav() {
        var trigger = $('#mobile-nav-trigger');
        var mobileNav = $('#header-mobile-nav');

        if (!trigger.length || !mobileNav.length) {
            return;
        }

        trigger.on('click', function () {
            var isOpen = trigger.attr('aria-expanded') === 'true';

            trigger.attr('aria-expanded', String(!isOpen));
            trigger.toggleClass('is-open', !isOpen);
            mobileNav.stop(true, true).slideToggle(180);
        });

        $(window).on('resize', function () {
            if (window.innerWidth > 470) {
                trigger.attr('aria-expanded', 'false').removeClass('is-open');
                mobileNav.stop(true, true).hide();
            }
        });
    }

    function initSlider() {
        var slider = $('#gl-slider-slides');
        var focusableSelector = 'a, button, input, select, textarea, iframe, [tabindex]';

        if (!slider.length || typeof $.fn.slick !== 'function') {
            return;
        }

        function syncSliderAccessibility() {
            slider.find('.slick-slide').each(function () {
                var slide = $(this);
                var isHidden = slide.attr('aria-hidden') === 'true';

                if (isHidden) {
                    slide.attr('inert', '');
                } else {
                    slide.removeAttr('inert');
                }

                slide.find(focusableSelector).each(function () {
                    var element = $(this);

                    if (isHidden) {
                        if (!element.is('[data-gl-original-tabindex]')) {
                            element.attr('data-gl-original-tabindex', element.attr('tabindex') || '');
                        }
                        element.attr('tabindex', '-1');
                        return;
                    }

                    if (!element.is('[data-gl-original-tabindex]')) {
                        return;
                    }

                    if (element.attr('data-gl-original-tabindex') === '') {
                        element.removeAttr('tabindex');
                    } else {
                        element.attr('tabindex', element.attr('data-gl-original-tabindex'));
                    }
                    element.removeAttr('data-gl-original-tabindex');
                });
            });
        }

        slider.on('init reInit afterChange', function () {
            window.requestAnimationFrame(syncSliderAccessibility);
        });

        slider.slick({
            dots: false,
            infinite: true,
            speed: 300,
            slidesToShow: 1,
            slidesToScroll: 1,
            prevArrow: '#gl-slider-prev',
            nextArrow: '#gl-slider-next',
            autoplay: true,
            autoplaySpeed: 5000,
            adaptiveHeight: false
        });
    }

    function initFaqs() {
        var faqButtons = document.querySelectorAll('.faq-question');

        faqButtons.forEach(function (button) {
            button.addEventListener('click', function () {
                var isExpanded = button.getAttribute('aria-expanded') === 'true';
                var answerId = button.getAttribute('aria-controls');
                var answer = answerId ? document.getElementById(answerId) : null;

                button.classList.toggle('active', !isExpanded);
                button.setAttribute('aria-expanded', String(!isExpanded));

                if (!answer) {
                    return;
                }

                if (isExpanded) {
                    answer.setAttribute('hidden', 'hidden');
                    return;
                }

                answer.removeAttribute('hidden');
            });
        });
    }

    function initCounters() {
        var counterElements = document.querySelectorAll('.gl-counters-card-value[data-counter-target]');

        if (!counterElements.length) {
            return;
        }

        function animateCounter(element) {
            if (element.dataset.counterAnimated === 'true') {
                return;
            }

            var targetRaw = String(element.getAttribute('data-counter-target') || '').replace(/,/g, '').trim();
            var target = Number(targetRaw);
            var decimals = targetRaw.indexOf('.') >= 0 ? (targetRaw.split('.')[1] || '').length : 0;
            var duration = 1400;
            var startTime = null;

            if (!isFinite(target)) {
                element.textContent = element.getAttribute('data-counter-target') || '0';
                element.dataset.counterAnimated = 'true';
                return;
            }

            function formatValue(value) {
                return value.toLocaleString(undefined, {
                    minimumFractionDigits: decimals,
                    maximumFractionDigits: decimals
                });
            }

            function step(timestamp) {
                if (!startTime) {
                    startTime = timestamp;
                }

                var progress = Math.min((timestamp - startTime) / duration, 1);
                var currentValue = target * progress;

                if (decimals === 0) {
                    currentValue = Math.round(currentValue);
                }

                element.textContent = formatValue(currentValue);

                if (progress < 1) {
                    window.requestAnimationFrame(step);
                    return;
                }

                element.textContent = formatValue(target);
                element.dataset.counterAnimated = 'true';
            }

            window.requestAnimationFrame(step);
        }

        if (!('IntersectionObserver' in window)) {
            counterElements.forEach(animateCounter);
            return;
        }

        var observer = new IntersectionObserver(function (entries, currentObserver) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) {
                    return;
                }

                animateCounter(entry.target);
                currentObserver.unobserve(entry.target);
            });
        }, {
            threshold: 0.35
        });

        counterElements.forEach(function (element) {
            observer.observe(element);
        });
    }

    function initFormTimestamps() {
        // The static pages carry a frozen form_ts value; the API's min-fill-time
        // spam gate only works when this is stamped at page load.
        var stamp = String(Math.floor(Date.now() / 1000));

        document.querySelectorAll('input[name="form_ts"]').forEach(function (field) {
            field.value = stamp;
        });
    }

    function initBlogPagination() {
        // Progressive enhancement for /blog/ pagination: fetch the next page in
        // the background and swap the card grid + pagination in place, instead
        // of a full page reload. URLs, SEO and no-JS behavior are unchanged —
        // the server still renders every /blog/pg/N/ page; any failure falls
        // back to a normal navigation.
        var grid = document.getElementById('gl-blog-grid');
        var paginate = document.getElementById('b-paginate');
        if (!grid || !paginate || !window.fetch || !window.DOMParser ||
            !(window.history && window.history.pushState) || !Element.prototype.closest) return;

        function loadPage(url, push) {
            fetch(url).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.text();
            }).then(function (html) {
                var doc = new DOMParser().parseFromString(html, 'text/html');
                var newGrid = doc.getElementById('gl-blog-grid');
                var newPaginate = doc.getElementById('b-paginate');
                if (!newGrid || !newPaginate) throw new Error('unexpected markup');
                grid.innerHTML = newGrid.innerHTML;
                paginate.innerHTML = newPaginate.innerHTML;
                if (push) history.pushState(null, '', url);
                window.scrollTo(0, 0);
            }).catch(function () {
                window.location.href = url;
            });
        }

        paginate.addEventListener('click', function (e) {
            var link = e.target.closest('a');
            if (!link || !paginate.contains(link)) return;
            var href = link.getAttribute('href');
            if (!/^\/blog\/pg\/\d+\/$/.test(href)) return;
            e.preventDefault();
            loadPage(href, true);
        });

        window.addEventListener('popstate', function () {
            if (/^\/blog(\/pg\/\d+\/)?$/.test(window.location.pathname)) {
                loadPage(window.location.pathname, false);
            }
        });
    }

    $(function () {
        setActiveNavLink();
        initMobileNav();
        initSlider();
        initFaqs();
        initCounters();
        initFormTimestamps();
        initBlogPagination();
    });
}(jQuery));
