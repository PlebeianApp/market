export const scrollToElementWithOffset = (selector: string | HTMLElement, offset: number) => {
	const element = typeof selector === 'string' ? document.querySelector(selector) : selector

	if (!element) return

	const elementPosition = element.getBoundingClientRect().top
	const currentScrollY = window.pageYOffset
	const targetPosition = elementPosition + currentScrollY - offset

	window.scrollTo({
		top: targetPosition,
		behavior: 'smooth',
	})
}
