<script>
	export let value = 0
</script>

<button on:click={() => value++}>+1</button>
<output>{ value }</output>
<button on:click={() => value--}>-1</button>

<style>
	button {
		width: 48px;
	}
</style>
