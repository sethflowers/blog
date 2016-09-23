---
layout: post
title: RGB for Beginners
date: 2012-04-26 00:11
comments: true
categories: []
---
More than once I've been surprised to learn that a coworker has no idea how to read RGB values. If you work in html or <a href="http://www.w3.org/TR/css3-color/" target="_blank">CSS</a> or [insert your favorite UI technology here], you should have a basic understanding of the <a href="http://en.wikipedia.org/wiki/RGB_color_model" title="RGB" target="_blank">RGB color model</a>.

<strong>Red Green Blue or RRGGBB</strong>
Colors are often written using six <a href="http://en.wikipedia.org/wiki/Hexadecimal" title="Hexadecimal" target="_blank">hexadecimal</a> values, preceded by a pound or hash sign, where the first two represent red, the middle two represent green, and the last two represent blue. So, the color "#12F547" means that there is a red value of "12", a green value of "F5", and a blue value of "47". The lower the value, the less of that color that goes into the final resulting color.

<strong>White and Black</strong>
The range of possible values for just one portion of the color is "00" to "FF". If all three of the colors are 0, then the final color is black. So, "#000000" is equal to black. Conversely, if all three of the colors are as high as possible, the resulting color is white. So, "#FFFFFF" is white. 

<strong>Shades of Gray</strong>
You make shades of gray by setting the R and the G and the B values to the same Hexadecimal number. So, "#707070" is a middle of the road gray color, because the red portion, as well as the green, and the blue portions are all "70" which is roughly half way between "00" and "FF". Likewise, "#C2C2C2" is a fairly light gray, because each portion carries the value "C2", which is pretty close to "FF", or white. Also, "#272727" is a very dark gray, because each portion carries the value "27", which is close to "00", or black.

<style type="text/css">
table.colorTable td { width: 50%; }
</style>
<table class="colorTable">
<tr><td>#FFFFFF</td><td style="background-color:#fff">&nbsp;</td></tr>
<tr><td>#EEEEEE</td><td style="background-color:#eee">&nbsp;</td></tr>
<tr><td>#DDDDDD</td><td style="background-color:#ddd">&nbsp;</td></tr>
<tr><td>#CCCCCC</td><td style="background-color:#ccc">&nbsp;</td></tr>
<tr><td>#BBBBBB</td><td style="background-color:#bbb">&nbsp;</td></tr>
<tr><td>#AAAAAA</td><td style="background-color:#aaa">&nbsp;</td></tr>
<tr><td>#999999</td><td style="background-color:#999">&nbsp;</td></tr>
<tr><td>#888888</td><td style="background-color:#888">&nbsp;</td></tr>
<tr><td>#777777</td><td style="background-color:#777">&nbsp;</td></tr>
<tr><td>#666666</td><td style="background-color:#666">&nbsp;</td></tr>
<tr><td>#555555</td><td style="background-color:#555">&nbsp;</td></tr>
<tr><td>#444444</td><td style="background-color:#444">&nbsp;</td></tr>
<tr><td>#333333</td><td style="background-color:#333">&nbsp;</td></tr>
<tr><td>#222222</td><td style="background-color:#222">&nbsp;</td></tr>
<tr><td>#111111</td><td style="background-color:#111">&nbsp;</td></tr>
<tr><td>#000000</td><td style="background-color:#000">&nbsp;</td></tr>
</table>

<strong>Just Red</strong>
If we wanted just a red value, we would raise the red portion of the color, and lower the green and blue portions. So, "#FF0000" is fully red. If we wanted a darker red, we would reduce the red value. So, "#770000" results in a darker red.
<table class="colorTable">
<tr><td>#FF0000</td><td style="background-color:#f00">&nbsp;</td></tr>
<tr><td>#EE0000</td><td style="background-color:#e00">&nbsp;</td></tr>
<tr><td>#DD0000</td><td style="background-color:#d00">&nbsp;</td></tr>
<tr><td>#CC0000</td><td style="background-color:#c00">&nbsp;</td></tr>
<tr><td>#BB0000</td><td style="background-color:#b00">&nbsp;</td></tr>
<tr><td>#AA0000</td><td style="background-color:#a00">&nbsp;</td></tr>
<tr><td>#990000</td><td style="background-color:#900">&nbsp;</td></tr>
<tr><td>#880000</td><td style="background-color:#800">&nbsp;</td></tr>
<tr><td>#770000</td><td style="background-color:#700">&nbsp;</td></tr>
<tr><td>#660000</td><td style="background-color:#600">&nbsp;</td></tr>
<tr><td>#550000</td><td style="background-color:#500">&nbsp;</td></tr>
<tr><td>#440000</td><td style="background-color:#400">&nbsp;</td></tr>
<tr><td>#330000</td><td style="background-color:#300">&nbsp;</td></tr>
<tr><td>#220000</td><td style="background-color:#200">&nbsp;</td></tr>
<tr><td>#110000</td><td style="background-color:#100">&nbsp;</td></tr>
<tr><td>#000000</td><td style="background-color:#000">&nbsp;</td></tr>
</table>

<strong>Mixing Colors</strong>
By mixing different values of red, green, and blue, we can find other colors. Some simple ones are Red + Green = Yellow, Red + Blue = Magenta, and Green + Blue = Cyan.
<table class="colorTable">
<tr><td>#FFFF00</td><td style="background-color:#ff0">&nbsp;</td></tr>
<tr><td>#FF00FF</td><td style="background-color:#f0f">&nbsp;</td></tr>
<tr><td>#00FFFF</td><td style="background-color:#0ff">&nbsp;</td></tr>
</table>

<strong>RGBA or ARGB</strong>
In some technologies, like <a href="http://msdn.microsoft.com/en-us/library/system.windows.media.color.aspx" target="_blank"> Microsoft's WPF</a>, you can specify an alpha value to control the transparency of the color. A value of "FF" is fully on, so it is fully opaque, whereas a value of "00" is fully off, or transparent. Depending on the technology, the alpha value might come at the beginning of the color, or at the end. In WPF, it comes at the beginning, so a value of "#<strong>FF</strong>006400" is equal to a fully opaque dark green color.

<strong>rgb(255,255,255)</strong>
Some technologies, like <a href="http://www.w3.org/TR/css3-color/" target="_blank">CSS</a>, allow you to specify colors using a format of rgb(x,y,z) where x, y, and z are all numbers from 0 to 255 and x represents the red value, y represents the green value, and z represents the blue value. In case you are not familiar with hexadecimal, the decimal value 255 is equal to the hexadecimal value "FF", so rgb(255,0,255) is equal to #FF00FF.

<strong>Conclusion</strong>
Now, when reviewing code, you should immediately be able to recognize that #00FF00 and rgb(0,255,0) both represent green colors. You should also be able to tell that #009A00 is a darker green than #00FF00.
