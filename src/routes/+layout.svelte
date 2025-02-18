<script lang="ts">
	import '../app.css';
	import { page } from '$app/stores';
	let { children } = $props();

	const siteTitle = "Recep Tayyip Erdoğan Proje İmam Hatip Lisesi";
	const siteDescription = "Recep Tayyip Erdoğan Proje İmam Hatip Lisesi 5. Sınıf Kayıt Kabul Sınavı başvuru sistemi. Online sınav başvurusu yapın, sınav giriş belgenizi alın.";
	const siteUrl = "https://rteprojeihl.com.tr"; // Replace with your actual domain
	const siteLogo = "/favicon.png";
</script>

<svelte:head>
	<title>{siteTitle}</title>
	<meta name="description" content={siteDescription} />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
	
	<!-- Canonical URL -->
	<link rel="canonical" href="{siteUrl}{$page.url.pathname}" />
	
	<!-- Open Graph / Facebook -->
	<meta property="og:type" content="website" />
	<meta property="og:url" content="{siteUrl}{$page.url.pathname}" />
	<meta property="og:title" content={siteTitle} />
	<meta property="og:description" content={siteDescription} />
	<meta property="og:image" content="{siteUrl}{siteLogo}" />
	
	<!-- Twitter -->
	<meta property="twitter:card" content="summary_large_image" />
	<meta property="twitter:url" content="{siteUrl}{$page.url.pathname}" />
	<meta property="twitter:title" content={siteTitle} />
	<meta property="twitter:description" content={siteDescription} />
	<meta property="twitter:image" content="{siteUrl}{siteLogo}" />
	
	<!-- Additional SEO Meta Tags -->
	<meta name="keywords" content="imam hatip lisesi, proje okul, sınav başvuru, kayıt kabul sınavı, 5. sınıf sınavı, RTE Proje İHL" />
	<meta name="author" content="Recep Tayyip Erdoğan Proje İmam Hatip Lisesi" />
	<meta name="robots" content="index, follow" />
	
	<!-- Favicon -->
	<link rel="icon" type="image/png" href={siteLogo} />
	<link rel="apple-touch-icon" href={siteLogo} />
</svelte:head>

{@render children()}
