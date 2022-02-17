<script>
	import { createPanelConnection } from "./socketio";
	import { updateScreen } from "./socketio";
	import { onMount } from "svelte";
	import { reset } from "./socketio";
	onMount(() => {
		createPanelConnection();
	});
	function blueUp() {
		if (document.getElementById("blueWins").value != 4) {
			document.getElementById("blueWins").value =
				parseInt(document.getElementById("blueWins").value) + 1;
		}
	}
	function orngUp() {
		if (document.getElementById("orngWins").value != 4) {
			document.getElementById("orngWins").value =
				parseInt(document.getElementById("orngWins").value) + 1;
		}
	}
	function resetWins() {
		document.getElementById("orngWins").value = 0;
		document.getElementById("blueWins").value = 0;
	}
	function resetLogos() {
		document.getElementById("orng-icon").value = "";
		document.getElementById("blue-icon").value = "";
	}
	function resetColors() {
		document.getElementById("orng-color").value = "#000000";
		document.getElementById("orng-color-2").value = "#ee8723";
		document.getElementById("blue-color").value = "#52acfe";
		document.getElementById("blue-color-2").value = "#000000";
		document.getElementById("orng-color-picker").value = "#000000";
		document.getElementById("orng-color-picker-2").value = "#ee8723";
		document.getElementById("blue-color-picker").value = "#52acfe";
		document.getElementById("blue-color-picker-2").value = "#000000";
	}
	function bluecolor() {
		document.getElementById("blue-color-picker").value =
			document.getElementById("blue-color").value;
	}
	function orangecolor() {
		document.getElementById("orng-color-picker").value =
			document.getElementById("orng-color").value;
	}
	function bluecolortobox() {
		document.getElementById("blue-color").value =
			document.getElementById("blue-color-picker").value;
	}
	function orangecolortobox() {
		document.getElementById("orng-color").value =
			document.getElementById("orng-color-picker").value;
	}
	function bluecolor2() {
		document.getElementById("blue-color-picker-2").value =
			document.getElementById("blue-color-2").value;
	}
	function orangecolor2() {
		document.getElementById("orng-color-picker-2").value =
			document.getElementById("orng-color-2").value;
	}
	function bluecolortobox2() {
		document.getElementById("blue-color-2").value =
			document.getElementById("blue-color-picker-2").value;
	}
	function orangecolortobox2() {
		document.getElementById("orng-color-2").value =
			document.getElementById("orng-color-picker-2").value;
	}
</script>

<main>
	<button id="update-btn" class="update-buttons" on:click={() => updateScreen()}>Update<br>Overlay</button>
	<button id="reset-wins" class="update-buttons" on:click={() => resetWins()}>Reset<br>Wins</button>

	<div style="color: lightskyblue; font-family: integral-reg; font-size: 24px">GAME / SERIES INFO</div>
	<div style="display: flex">
		<div>
			<label for="series-length">Choose a Series Length</label>
			<input list="series-lengths" id="series-length">
			<datalist name="series-length" id="series-lengths">
				<option value="Best of 1">Best of 1</option>
				<option value="Best of 3">Best of 3</option>
				<option value="Best of 5">Best of 5</option>
				<option value="Best of 7">Best of 7</option>
			</datalist>
		</div>
		<div style="padding-left: 20px">
			<label for="topbox">Text Above Scoreboard</label>
			<input type="text" id="topbox">
		</div>
	</div>
	<br />
	<div style="color: lightskyblue; font-family: integral-reg; font-size: 24px">TEAM NAMES</div>
	<div style="display: flex">
		<div>
			<label for="blue-name" style="color: lightskyblue">Input blue name here</label>
			<input type="text" id="blue-name" name="blue-name" value="" />
		</div>
		<div style="padding-left: 20px">
			<label for="orng-name" style="color: orange">Input orange name here</label>
			<input type="text" id="orng-name" name="orng-name" value="" />
		</div>
	</div>
	<br />
	<div style="color: lightskyblue; font-family: integral-reg; font-size: 24px">WIN COUNTERS</div>
	<div style="display: flex">
		<div>
			<label for="blueWins" style="color: lightskyblue">Set wins for Blue (left)</label>

			<input
				type="number"
				id="blueWins"
				name="blueWins"
				min="0"
				max="4"
				value="0"
				style="width: 90px"
			/>
			<button class="bluebtn"	style="width: 100px" on:click={() => blueUp()}>Blue Win</button>
		</div>

		<div style="padding-left: 20px">
			<label for="orngWins" style="color: orange">Set wins for Orange (right)</label>

			<input
				type="number"
				id="orngWins"
				name="orngWins"
				min="0"
				max="4"
				value="0"
				style="width: 93px"
			/>
			<button class="orngbtn" style="width: 100px" on:click={() => orngUp()}>Orange Win</button>
		</div>
	</div>
	<br>

	<button id="reset-colors" class="update-buttons" on:click={() => resetColors()}>Reset<br>Colors</button>
	<button id="reset-logos" class="update-buttons" on:click={() => resetLogos()}>Reset<br>Logos</button>

	<div style="color: lightskyblue; font-family: integral-reg; font-size: 24px">TEAM COLORS</div>
	<div class="color-selctors" style="display: flex">
		<div>
			<label for="blue-color" style="color: lightskyblue">Left / Blue Primary</label>
			<input type="text" id="blue-color" name="blue-color" style="width: 140px" value="#52acfe" on:keyup={() => bluecolor()}/>
			<input type="color" id="blue-color-picker" name="blue-color-picker" value="#52acfe" on:change={() => bluecolortobox()}>
		</div>
		<br>
		<div style="padding-left: 20px">
			<label for="orng-color-2" style="color: orange">Right / Orange Primary</label>
			<input type="text" id="orng-color-2" name="orng-color-2" style="width: 140px" value="#ee8723" on:keyup={() => orangecolor2()}/>
			<input type="color" id="orng-color-picker-2" name="orng-color-picker-2" value="#ee8723" on:change={() => orangecolortobox2()}>
		</div>
	</div>
	<br>
	<div class="color-selectors" style="display: flex">
		<div>
			<label for="blue-color-2" style="color: lightskyblue">Left / Blue Secondary</label>
			<input type="text" id="blue-color-2" name="blue-color-2" style="width: 140px" value="#000000" on:keyup={() => bluecolor2()}/>
			<input type="color" id="blue-color-picker-2" name="blue-color-picker-2" value="#000000" on:change={() => bluecolortobox2()}>
		</div>
		<div style="padding-left: 20px">
			<label for="orng-color" style="color: orange">Right / Orange Secondary</label>
			<input type="text" id="orng-color" name="orng-color" style="width: 140px" value="#000000" on:keyup={() => orangecolor()}/>
			<input type="color" id="orng-color-picker" name="orng-color-picker" value="#000000" on:change={() => orangecolortobox()}>
		</div>
	</div>
	<br />

	<div style="color: lightskyblue; font-family: integral-reg; font-size: 24px">TEAM LOGOS</div>
	<div>
		<label for="blue-icon" style="color: lightskyblue">Input Blue Image Here</label>
		<input type="url" id="blue-icon" name="blue-icon" style="width: 410px"/>
	</div>
	<div>
		<label for="orng-icon" style="color: orange">Input Orange Image Here</label>
		<input type="url" id="orng-icon" name="orng-icon" style="width: 410px"/>
	</div>
</main>

<style>
</style>
